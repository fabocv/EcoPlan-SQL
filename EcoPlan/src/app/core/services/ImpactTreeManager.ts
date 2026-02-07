import { AnalysisResult } from "./QueryImpactAnalyzer";

export interface ImpactNode {
  id: string;
  label: string;
  value: number;        // 0.0 a 1.0 (normalizado)
  weight: number;       // Peso relativo frente a sus hermanos
  children?: ImpactNode[];
  isCritical?: boolean;
  description?: string; // Para explicar el "porqué" al usuario
}

export interface SmartAnalysisResult extends AnalysisResult {
  execTimeInExplain: boolean;
  impactTree: ImpactNode;
  topOffenders: ImpactNode[];
  breakdown: string; // Explicación de la causa raíz
}

export class ImpactTreeManager {
  
  /**
   * Función de Clamping para asegurar rangos 0-1
   */
  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  /**
   * Normalización Logarítmica para métricas que escalan rápido
   * @param actual Valor observado
   * @param critical Umbral donde el valor se considera 1.0 (crítico)
   */
  public logNormalize(actual: number, critical: number): number {
    if (actual <= 1) return 0; // Evitar log de 0 o 1
    const val = Math.log2(actual) / Math.log2(critical);
    return this.clamp(val);
  }

  /**
   * Calcula el valor de un nodo basado en sus hijos (Weighted Average)
   */
  public resolve(node: ImpactNode): number {
    if (!node.children || node.children.length === 0) {
      return node.value;
    }

    const totalWeight = node.children.reduce((acc, child) => acc + child.weight, 0);
    if (totalWeight === 0) return 0;

    const weightedAverage = node.children.reduce((acc, child) => {
    return acc + (this.resolve(child) * child.weight);
  }, 0) / (totalWeight || 1);

    const maxValue = Math.max(...node.children.map(c => c.value));

    const criticalValues = node.children
    .filter(c => c.isCritical)
    .map(c => c.value);
  
    const maxCritical = criticalValues.length > 0 ? Math.max(...criticalValues) : 0;

    const precalculo = (weightedAverage * 0.4) + (maxValue * 0.6);
    node.value = Math.max(precalculo, maxCritical);
    return node.value;
  }

  /**
   * Aplana el árbol para buscar los mayores problemas (Top Offenders)
   */
  public flatten(node: ImpactNode, results: ImpactNode[] = []): ImpactNode[] {
    results.push(node);
    if (node.children) {
      node.children.forEach(child => this.flatten(child, results));
    }
    return results;
  }

  /**
   * Identifica los 3 cuellos de botella más importantes
   */
  public getTopOffenders(node: ImpactNode): ImpactNode[] {
    let leaves: ImpactNode[] = [];
    const flatten = (n: ImpactNode) => {
        if (!n.children || n.children.length === 0) {
            leaves.push(n);
        } else {
            n.children.forEach(flatten);
        }
    };
    flatten(node);
    // Ordenar por impacto real: Valor * Peso
    return leaves
        .filter(l => l.value > 0.1)
        .sort((a, b) => (b.value * b.weight) - (a.value * a.weight))
        .slice(0, 3);
}
}