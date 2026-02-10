import { Injectable } from '@angular/core';
// Asegúrate de que estas rutas sean correctas en tu proyecto
import { ImpactNode } from './ImpactTreeManager';
import { RawMetrics } from './QueryImpactAnalyzer';

// Importamos los Explainers (Asumiendo que ya creaste los archivos correspondientes)
import { RecursiveBombExplainer } from './explainers/RecursiveBombExplainer';
//import { DiskSortExplainer } from './explainers/DiskSortExplainer'; // Antes WorkMemExplainer
//import { HighWasteExplainer } from './explainers/HighWasteExplainer'; // Antes InefficientIndexExplainer
//import { CartesianExplainer } from './explainers/CartesianExplainer'; // O usar GenericExplainer

// --- 1. DEFINICIÓN DE TIPOS Y INTERFACES ---

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type SuggestionKind = 'corrective' | 'opportunistic' | 'preventive' | 'optimization';

/**
 * Define la regla estática (el "molde")
 */
interface Template {
  id: string;
  solution: string;
  kind: SuggestionKind;
  text: string;
  triggerNodeId?: string; // Pista: 'recursive_expansion', 'mem', 'waste', etc.
}

/**
 * Sugerencia evaluada pero aún sin texto largo (Markdown)
 */
export interface EvaluatedSuggestion {
  type: string;           // ID del template (ej: 'DISK_SORT')
  label: string;          // Título humano
  solution: string;       // Solución corta
  kind: SuggestionKind;
  severity: Severity;
  score: number;          // 0.0 a 1.0 (Impacto relativo)
  
  // Nodo específico del árbol que causó el problema
  triggeringNode: {
    id: string;
    value: number;
  };
  
  metrics: RawMetrics;    // Datos crudos para el Explainer
}

/**
 * El producto final que consume el Frontend
 */
export interface ExplainedSuggestion extends EvaluatedSuggestion {
  title: string;          // Puede ser igual a label o enriquecido
  markdown: string;       // Explicación completa generada
  evidence: string[];     // Pistas visuales (ej: "Disk: 12MB")
  
  // Resumen de impacto para gráficas
  impactSummary: {
    node: string;
    value: number;
    contribution: number; // Porcentaje de culpa sobre el total (0-100)
  };
}

/**
 * Contexto necesario para generar explicaciones
 */
export interface ExplanationContext {
  impactTree: ImpactNode;
  impactSaturation: number; // 0.0 a 1.0 (Qué tan "lleno" está el sistema)
  dominantNodes: ImpactNode[];
  rawMetrics: RawMetrics;
  plan: string;
}

/**
 * Contrato para las clases que generan texto (Strategies)
 */
export interface SuggestionExplainer {
  extractEvidence(plan: string, metrics: RawMetrics): string[];
  buildExplanation(
    suggestion: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext,
  ): string;
}

// --- 2. REGISTRO DE EXPLICADORES ---
// Mapea los IDs de los Templates con las clases lógicas
const EXPLAINERS: Record<string, SuggestionExplainer> = {
  RECURSIVE_BOMB: new RecursiveBombExplainer(),
  //DISK_SORT: new DiskSortExplainer(),        // Maneja problemas de WorkMem
  //HIGH_WASTE_SCAN: new HighWasteExplainer(), // Maneja problemas de filtros ineficientes
  //CARTESIAN_PRODUCT: new CartesianExplainer(), // O un GenericExplainer si no existe
};

// Explainer por defecto para casos no mapeados
class GenericExplainer implements SuggestionExplainer {
  extractEvidence(p: string, m: RawMetrics) { return []; }
  buildExplanation(s: EvaluatedSuggestion) { 
    return `### Análisis\nSe detectó: **${s.label}**.\n\nSugerencia: ${s.solution}`; 
  }
}

// --- 3. SERVICIO PRINCIPAL ---

@Injectable({ providedIn: 'root' })
export class SuggestionGen {
  
  constructor() {}

  /**
   * 🚀 MÉTODO PÚBLICO PRINCIPAL
   * Orquesta todo el proceso: Evaluar -> Filtrar -> Explicar
   */
  public generateSmartSuggestions(
    context: ExplanationContext,
    plan: string,
  ): ExplainedSuggestion[] {
    
    // 1. Evaluar qué plantillas aplican según las métricas
    const evaluated: EvaluatedSuggestion[] = this.evaluateTemplates(context, plan);

    if (evaluated.length === 0) return [];

    // 2. Filtrar por importancia si hay saturación (evitar ruido visual)
    const filtered = this.filterByKind(evaluated, context.impactSaturation);

    if (filtered.length === 0) return [];

    // 3. Colapsar duplicados (si la misma regla salta varias veces, tomar la peor)
    const collapsed = this.collapseSuggestions(filtered);

    // 4. Generar explicaciones enriquecidas (Evidencia + Markdown)
    return this.buildExplanations(collapsed, context);
  }

  // --- MOTOR DE REGLAS ---

  private evaluateTemplates(context: ExplanationContext, plan: string): EvaluatedSuggestion[] {
    const evaluatedSuggestions: EvaluatedSuggestion[] = [];
    const templates = this.getTemplates();

    for (const template of templates) {
      if (this.isTemplateRelevant(template, context, plan)) {
        
        // 1. Identificar el nodo culpable
        // Si el template tiene una pista ('mem', 'waste'), buscamos ese nodo específico.
        // Si no, usamos el nodo más costoso (dominantNode).
        const targetNodeId = template.triggerNodeId;
        
        let specificNode: ImpactNode | undefined;
        if (targetNodeId) {
             specificNode = this.findNodeByTrigger(targetNodeId, context.impactTree, plan);
        }

        // Fallback al nodo dominante si no encontramos uno específico
        const triggeringNodeRaw = specificNode || context.dominantNodes[0];
        
        // Protección contra undefined
        const triggeringNodeData = triggeringNodeRaw 
            ? { id: triggeringNodeRaw.id, value: triggeringNodeRaw.value } 
            : { id: 'unknown', value: 0 };

        // 2. Crear la sugerencia base
        const suggestion: EvaluatedSuggestion = {
          type: template.id,
          label: template.text,
          solution: template.solution,
          kind: template.kind,
          severity: this.evaluateSeverity(template, context),
          score: (triggeringNodeData.value || 0), // Score crudo del nodo
          triggeringNode: triggeringNodeData,
          metrics: context.rawMetrics
        };

        evaluatedSuggestions.push(suggestion);
      }
    }

    // Ordenar por severidad (Critical > High > Medium...)
    return this.sortSuggestionsBySeverity(evaluatedSuggestions);
  }

  private getTemplates(): Template[] {
    return [
      {
        id: 'RECURSIVE_BOMB',
        solution: 'Añadir índice en columna de unión o LIMIT.',
        kind: 'corrective',
        text: 'Bomba Recursiva Detectada',
        triggerNodeId: 'recursive_expansion', // Pista para findNodeByTrigger
      },
      {
        id: 'DISK_SORT',
        solution: 'Incrementar work_mem o eliminar ORDER BY innecesarios.',
        kind: 'corrective',
        text: 'Ordenamiento en Disco (Swap)',
        triggerNodeId: 'mem',
      },
      {
        id: 'CARTESIAN_PRODUCT',
        solution: 'Revisar condiciones de JOIN faltantes.',
        kind: 'corrective',
        text: 'Producto Cartesiano',
        triggerNodeId: 'complexity',
      },
      {
        id: 'HIGH_WASTE_SCAN',
        solution: 'Crear índice compuesto que cubra los filtros.',
        kind: 'optimization',
        text: 'Filtrado Ineficiente (High Waste)',
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
        // Lógica: Recursión + (Loop Infinito O Escaneo Secuencial dentro del loop)
        return (m.recursiveDepth || 0) > 0 && ((m.seqScanInLoop || false) || (m.maxLoops || 0) > 1000);

      case 'DISK_SORT':
        // Lógica: Uso de disco explícito o archivos temporales
        return (m.hasDiskSort || false) || (m.tempFilesMb || 0) > 0;

      case 'CARTESIAN_PRODUCT':
        return m.isCartesian || false;

      case 'HIGH_WASTE_SCAN':
        // Lógica: Se descartan más del 80% de las filas leídas
        const wasteRatio = m.wasteRatio || 0;
        return wasteRatio > 0.8 && (m.actualRows || 0) > 1000;

      default:
        return false;
    }
  }

  private evaluateSeverity(template: Template, context: ExplanationContext): Severity {
    // 1. Severidad base por tipo
    if (template.kind === 'corrective') return 'high';
    if (template.kind === 'optimization') return 'medium';

    // 2. Ajustes dinámicos
    const m = context.rawMetrics;
    
    if (template.id === 'DISK_SORT' && (m.tempFilesMb || 0) > 50) return 'critical';
    if (template.id === 'RECURSIVE_BOMB' && (m.recursiveDepth || 0) > 50) return 'critical';

    // 3. Ajuste por saturación global
    if (context.impactSaturation > 0.8) return 'critical';

    return 'info';
  }

  // --- GENERACIÓN DE CONTENIDO (Markdown) ---

  public buildExplanations(
    suggestions: EvaluatedSuggestion[],
    context: ExplanationContext,
  ): ExplainedSuggestion[] {
    
    // Calculamos el impacto total del árbol para saber el % de contribución
    const totalTreeImpact = this.calculateTotalImpact(context.impactTree);

    return suggestions.map((s) => {
      // 1. Recuperamos el nodo completo del árbol para que el explainer tenga acceso a sus hijos/stats
      const node = this.findNodeRecursive(context.impactTree, s.triggeringNode.id);

      // 2. Buscamos el Explainer correspondiente
      const explainer = EXPLAINERS[s.type] || new GenericExplainer();

      // 3. Generamos el texto explicativo
      const explanation = explainer.buildExplanation(s, node, context);
      const evidence = explainer.extractEvidence(context.plan, context.rawMetrics);

      // 4. Calculamos contribución porcentual
      const nodeVal = node ? node.value : 0;
      const contribution = totalTreeImpact > 0 
        ? Math.round((nodeVal / totalTreeImpact) * 100) 
        : 0;

      // 5. Construimos el objeto final
      return {
        ...s, // Heredamos type, label, severity, metrics...
        title: s.label,
        markdown: explanation,
        evidence: evidence,
        impactSummary: {
          node: s.triggeringNode.id,
          value: nodeVal,
          contribution: contribution,
        },
        // 'solution' ya viene de 's', no es necesario reasignar si la interfaz lo hereda
      };
    });
  }

  // --- HELPERS DE ÁRBOL Y LÓGICA ---

  /**
   * Busca un nodo basado en "pistas" del template (ej: "waste" busca Seq Scan)
   */
  private findNodeByTrigger(triggerHint: string, root: ImpactNode, planRaw: string): ImpactNode | undefined {
    const search = (node: ImpactNode, predicate: (n: ImpactNode) => boolean): ImpactNode | undefined => {
      if (predicate(node)) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = search(child, predicate);
          if (found) return found;
        }
      }
      return undefined;
    };

    switch (triggerHint) {
      case 'recursive_expansion':
        return search(root, n => n.label.includes('Recursive Union') || n.label.includes('CTE'));
      case 'mem':
        return search(root, n => n.label.includes('Sort') || n.label.includes('Hash'));
      case 'complexity':
        return search(root, n => n.label.includes('Nested Loop') || n.label.includes('Cross Join'));
      case 'waste':      
        return search(root, n => n.label.includes('Seq Scan') || n.label.includes('Filter'));
        
    }
    return undefined;
  }

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

  private calculateTotalImpact(node: ImpactNode): number {
    let total = 0;
    const traverse = (n: ImpactNode) => {
      const val = this.validateAndNormalizeImpactValue(n);
      if (val !== null) total += val;
      if (n.children) n.children.forEach(traverse);
    };
    traverse(node);
    return total;
  }

  private validateAndNormalizeImpactValue(node: ImpactNode): number | null {
    if (node.value < 0 || node.value > 1.5) return null; // Tolerancia leve > 1
    return node.value;
  }

  private filterByKind(suggestions: EvaluatedSuggestion[], saturation: number): EvaluatedSuggestion[] {
    if (saturation > 0.7) {
      // En alta carga, solo mostrar lo crítico
      return suggestions.filter(s => s.severity === 'critical' || s.severity === 'high');
    }
    return suggestions;
  }

  private collapseSuggestions(suggestions: EvaluatedSuggestion[]): EvaluatedSuggestion[] {
    const map = new Map<string, EvaluatedSuggestion>();
    suggestions.forEach(s => {
      // Usamos s.type como clave única (ej: RECURSIVE_BOMB)
      if (!map.has(s.type)) {
        map.set(s.type, s);
      } else {
        const existing = map.get(s.type)!;
        // Nos quedamos con la ocurrencia de mayor impacto
        if (s.score > existing.score) {
          map.set(s.type, s);
        }
      }
    });
    return Array.from(map.values());
  }

  private sortSuggestionsBySeverity(suggestions: EvaluatedSuggestion[]): EvaluatedSuggestion[] {
    const weights: Record<Severity, number> = {
      'critical': 5,
      'high': 4,
      'medium': 3,
      'low': 2,
      'info': 1
    };
    return suggestions.sort((a, b) => {
      const diff = weights[b.severity] - weights[a.severity];
      if (diff !== 0) return diff;
      return b.score - a.score; // Desempate por score numérico
    });
  }
}
