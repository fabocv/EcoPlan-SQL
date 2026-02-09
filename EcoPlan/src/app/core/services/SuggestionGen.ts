import { Injectable } from '@angular/core';
import { ImpactNode, ImpactTreeManager } from './ImpactTreeManager'; // Asumiendo ruta relativa
import { RawMetrics } from './QueryImpactAnalyzer'; // Asumiendo ruta relativa
import { RecursiveBombExplainer } from './explainers/RecursiveBombExplainer';
import { InefficientIndexExplainer } from './explainers/InefficientIndexExplainer';
import { WorkMemExplainer } from './explainers/WorkMemExplainer';

// Tipos definidos
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
type SuggestionKind = 'corrective' | 'opportunistic' | 'preventive' | 'optimization';

interface Template {
  id: string;
  solution: string;
  kind: SuggestionKind;
  text: string;
  triggerNodeId?: string; // Sugerencia de a qué nodo del árbol afecta principalmente
}

export interface EvaluatedSuggestion {
  templateId: string;
  kind: SuggestionKind;
  severity: Severity;
  text: string;
  solution: string;
  triggeringNode: {
    id: string;
    value: number;
  };
  impactScore: number;
}

export interface ExplanationContext {
  impactTree: ImpactNode;
  impactSaturation: number;
  dominantNodes: ImpactNode[];
  rawMetrics: RawMetrics;
  plan: string;
}

export interface ExplainedSuggestion {
  id: string;
  kind: SuggestionKind;
  severity: Severity;
  title: string;
  explanation: string;
  evidence: string[];
  recommendation: string;
  impactSummary: {
    node: string;
    value: number;
    contribution: number;
  };
}

// Interfaz para los Explainers (como el RecursiveBombExplainer)
export interface SuggestionExplainer {
  extractEvidence(plan: string, metrics: RawMetrics): string[];
  buildExplanation(
    suggestion: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext,
  ): string;
}

// REGISTRO DE EXPLICADORES
// Aquí conectamos los IDs de los templates con las clases especializadas
const EXPLAINERS: Record<string, SuggestionExplainer> = {
  RECURSIVE_BOMB: new RecursiveBombExplainer(),
  INNEFFICENT_INDEX: new InefficientIndexExplainer(),
  WORK_MEM: new WorkMemExplainer(),
  // 'DISK_SORT': new DiskSortExplainer(), // Futura implementación
  // 'CARTESIAN': new CartesianExplainer(), // Futura implementación
};

@Injectable({ providedIn: 'root' })
export class SuggestionGen {
  constructor() {}

  public generateSmartSuggestions(
    context: ExplanationContext,
    plan: string,
  ): ExplainedSuggestion[] {
    // Cambié el retorno a ExplainedSuggestion[] directo para facilitar uso

    // 1. Evaluar qué plantillas aplican según las métricas
    const evaluated: EvaluatedSuggestion[] = this.evaluateTemplates(context, plan);

    if (evaluated.length === 0) return [];

    // 2. Filtrar por importancia si hay saturación
    const filtered = this.filterByKind(evaluated, context.impactSaturation);

    if (filtered.length === 0) return [];

    // 3. Colapsar duplicados (si hubiera lógica repetitiva)
    const collapsed = this.collapseSuggestions(filtered);

    // 4. Generar explicaciones enriquecidas (Evidencia + Narrativa)
    return this.buildExplanations(collapsed, context);
  }

  private evaluateTemplates(context: ExplanationContext, plan: string): EvaluatedSuggestion[] {
    const evaluatedSuggestions: EvaluatedSuggestion[] = [];
    const templates = this.getTemplates();

    for (const template of templates) {
      if (this.isTemplateRelevant(template, context, plan)) {
        // Intentamos encontrar el nodo del árbol más relevante para esta sugerencia
        // Si el template define un nodo específico (ej: 'recursive_expansion') lo buscamos,
        // si no, usamos el nodo dominante general.
        const targetNodeId = template.triggerNodeId;
        const specificNode = targetNodeId
          ? this.findNodeRecursive(context.impactTree, targetNodeId)
          : null;

        const triggeringNode = specificNode ||
          context.dominantNodes[0] || { id: 'unknown', value: 0 };

        const suggestion: EvaluatedSuggestion = {
          templateId: template.id,
          solution: template.solution,
          kind: template.kind,
          severity: this.evaluateSeverity(template, context),
          text: template.text,
          triggeringNode: {
            id: triggeringNode.id,
            value: triggeringNode.value || 0,
          },
          impactScore: (triggeringNode.value || 0) * 100,
        };
        evaluatedSuggestions.push(suggestion);
      }
    }

    return evaluatedSuggestions;
  }

  // --- LÓGICA CORE: DEFINICIÓN DE REGLAS ---

  private getTemplates(): Template[] {
    return [
      {
        id: 'RECURSIVE_BOMB',
        solution: 'Añadir índice en columna de unión o LIMIT.',
        kind: 'corrective',
        text: 'Bomba Recursiva Detectada',
        triggerNodeId: 'recursive_expansion',
      },
      {
        id: 'DISK_SORT',
        solution: 'Incrementar work_mem o eliminar ORDER BY innecesarios.',
        kind: 'corrective',
        text: 'Ordenamiento costoso en Disco (Swap)',
        triggerNodeId: 'mem',
      },
      {
        id: 'CARTESIAN_PRODUCT',
        solution: 'Revisar condiciones de JOIN faltantes.',
        kind: 'corrective',
        text: 'Producto Cartesiano Identificado',
        triggerNodeId: 'complexity',
      },
      {
        id: 'HIGH_WASTE_SCAN',
        solution: 'Crear índice compuesto que cubra los filtros.',
        kind: 'optimization',
        text: 'Alto desperdicio de I/O (Filtrado ineficiente)',
        triggerNodeId: 'waste',
      },
    ];
  }

  private isTemplateRelevant(
    template: Template,
    context: ExplanationContext,
    plan: string,
  ): boolean {
    const m = context.rawMetrics;

    switch (template.id) {
      case 'RECURSIVE_BOMB':
        // Coincide con la lógica de tu RecursiveBombExplainer
        return m.recursiveDepth > 0 && (m.seqScanInLoop || m.maxLoops > 1000);

      case 'DISK_SORT':
        return m.hasDiskSort || m.tempFilesMb > 0;

      case 'CARTESIAN_PRODUCT':
        return m.isCartesian;

      case 'HIGH_WASTE_SCAN':
        // Si leemos mucho pero filtramos casi todo (Waste Ratio alto)
        return m.wasteRatio > 0.8 && m.executionTime > 50;

      default:
        return false;
    }
  }

  private evaluateSeverity(template: Template, context: ExplanationContext): Severity {
    let severity: Severity = 'info';
    const sat = context.impactSaturation;

    // Reglas base
    if (template.kind === 'corrective') severity = 'high';
    else if (template.kind === 'optimization') severity = 'medium';

    // Escalado por saturación del sistema
    if (sat > 0.8) severity = 'critical';

    // Reglas específicas
    if (template.id === 'DISK_SORT' && context.rawMetrics.tempFilesMb > 50) severity = 'critical';

    return severity;
  }

  // --- GENERACIÓN DE EXPLICACIONES ---

  public buildExplanations(
    suggestions: EvaluatedSuggestion[],
    context: ExplanationContext,
  ): ExplainedSuggestion[] {
    // Necesitamos calcular el impacto total para sacar porcentajes relativos
    const totalTreeImpact = this.calculateTotalImpact(context.impactTree);

    return suggestions.map((s) => {
      // 1. Buscamos el nodo real en el árbol para tener datos frescos
      const node = this.findNodeRecursive(context.impactTree, s.triggeringNode.id);

      // 2. Buscamos si existe un Explainer especializado (ej: RecursiveBombExplainer)
      const explainer = EXPLAINERS[s.templateId];

      // 3. Generamos contenido
      const explanation = explainer
        ? explainer.buildExplanation(s, node, context)
        : this.buildDefaultExplanation(s, node);

      const evidence = explainer
        ? explainer.extractEvidence(context.plan, context.rawMetrics)
        : this.extractDefaultEvidence(context.rawMetrics);

      // 4. Calculamos contribución porcentual al problema global
      const nodeVal = node ? node.value : 0;
      // Evitamos división por cero si el árbol está sano
      const contribution = totalTreeImpact > 0 ? Math.round((nodeVal / totalTreeImpact) * 100) : 0;

      return {
        id: s.templateId,
        kind: s.kind,
        severity: s.severity,
        title: s.text,
        explanation: explanation,
        evidence: evidence,
        recommendation: s.solution,
        impactSummary: {
          node: s.triggeringNode.id,
          value: nodeVal,
          contribution: contribution,
        },
      };
    });
  }

  // --- HELPERS ---

  private buildDefaultExplanation(s: EvaluatedSuggestion, node: ImpactNode | undefined): string {
    return `
### Análisis Genérico
Se ha detectado un patrón ineficiente relacionado con **${node?.label || 'Estructura de la consulta'}**.
El impacto calculado es de **${(node?.value || 0).toFixed(2)}** sobre 1.0.

**Recomendación:** ${s.solution}
        `.trim();
  }

  private extractDefaultEvidence(m: RawMetrics): string[] {
    const ev = [];
    if (m.executionTime > 100) ev.push(`⏱️ Tiempo alto: ${m.executionTime.toFixed(1)}ms`);
    if (m.hasDiskSort) ev.push(`💾 Uso de disco detectado`);
    return ev;
  }

  private calculateTotalImpact(node: ImpactNode): number {
    let total = 0;

    const traverseTree = (n: ImpactNode) => {
      // Verificamos el valor normalizado del nodo antes de sumarlo
      const normalizedValue = this.validateAndNormalizeImpactValue(n);
      if (normalizedValue !== null) {
        total += normalizedValue; // Solo sumamos si el valor es válido
      }

      // Procesamos los nodos hijos recursivamente
      if (n.children) {
        n.children.forEach((child) => traverseTree(child));
      }
    };

    traverseTree(node);
    return total; // Devolvemos el total calculado
  }

  // Método que evalúa y normaliza el valor de impacto
  private validateAndNormalizeImpactValue(node: ImpactNode): number | null {
    // Validamos que el valor esté dentro del rango permitido [0, 1]
    if (node.value < 0 || node.value > 1) {
      console.warn(`Valor de impacto no válido para el nodo ${node.id}: ${node.value}`);
      return null; // Retornamos null si el valor no es válido
    }

    // Validación adicional: si el nodo es crítico, comprobamos condiciones específicas
    if (node.isCritical) {
      if (node.value < 0.5) {
        console.warn(`Valor crítico bajo para el nodo ${node.id}: ${node.value}`);
        // Aquí podrías decidir cómo manejar nodos críticos con valores bajos
        return 0.5; // Ejemplo: elevar el valor mínimo a 0.5
      }
    }

    // Implementa más validaciones según sea necesario
    if (node.children && node.children.length > 0) {
      const childImpacts = node.children
        .map((child) => this.validateAndNormalizeImpactValue(child))
        .filter((n) => n !== null);

      // Si todos los hijos son válidos, puedes también querer evaluar su impacto
      if (childImpacts.length > 0) {
        const avgChildImpact =
          childImpacts.reduce((sum, value) => sum + (value || 0), 0) / childImpacts.length;
        // Ajuste de valor basado en sus hijos
        node.value = Math.max(node.value, avgChildImpact); // Por ejemplo, asegurarse de que el valor sea al menos el promedio
      }
    }

    // Retornamos el valor validado
    return node.value;
  }

  // Búsqueda recursiva para encontrar nodos por ID dentro del ImpactTree
  private findNodeRecursive(root: ImpactNode, targetId: string): ImpactNode | undefined {
    if (root.id === targetId) return root;
    if (root.children) {
      for (const child of root.children) {
        const found = this.findNodeRecursive(child, targetId);
        if (found) return found;
      }
    }
    return undefined;
  }

  private filterByKind(
    suggestions: EvaluatedSuggestion[],
    saturation: number,
  ): EvaluatedSuggestion[] {
    // Si el sistema está saturado (>0.7), solo mostramos problemas críticos/correctivos
    // para no abrumar al usuario.
    if (saturation > 0.7) {
      return suggestions.filter((s) => s.kind === 'corrective' || s.severity === 'critical');
    }
    return suggestions;
  }

  private collapseSuggestions(suggestions: EvaluatedSuggestion[]): EvaluatedSuggestion[] {
    const map = new Map<string, EvaluatedSuggestion>();
    suggestions.forEach((s) => {
      if (!map.has(s.templateId)) {
        map.set(s.templateId, s);
      } else {
        // Si ya existe, podríamos sumar scores o quedarnos con el de mayor severidad
        const existing = map.get(s.templateId)!;
        if (s.impactScore > existing.impactScore) {
          map.set(s.templateId, s);
        }
      }
    });
    return Array.from(map.values());
  }
}
