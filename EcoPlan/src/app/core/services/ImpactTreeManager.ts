import { CloudProvider, StructuralFlags } from "./QueryImpactAnalyzer";
import { ExplainedSuggestion } from "./SuggestionGen";


export interface ImpactNode {
  id: string;
  label: string;
  value: number;        // 0.0 a 1.0 (normalizado)
  weight: number;       // Peso relativo frente a sus hermanos
  children?: ImpactNode[];
  isCritical?: boolean;
  description?: string; // Para explicar el "porqué" al usuario
}

export interface SmartAnalysisResult {
  structuralFlags: StructuralFlags;
  executionTimeMs: number;
  economicImpact: number;
  suggestions: ExplainedSuggestion[];
  efficiencyScore: number;
  provider: CloudProvider;
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

  public resolve(node: ImpactNode): number {
    // Caso base: Si es una hoja, devolvemos su valor normalizado
    if (!node.children || node.children.length === 0) {
      return node.value;
    }

    // AGREGADO JERÁRQUICO: Obtenemos los valores resueltos de todos los hijos
    const childrenValues = node.children.map(child => this.resolve(child));
    
    // ✅ CAMBIO: Calcular WEIGHTED AVERAGE en lugar de MAX
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const weight = child.weight || 1;
      const childValue = childrenValues[i];
      
      weightedSum += childValue * weight;
      totalWeight += weight;
    }

    const avgValue = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // REGLA DE DOMINANCIA: Si un nodo crítico supera un umbral, amplificar
    if ((node.id === 'scalability' || node.id === 'query_impact') && avgValue >= 0.85) {
      node.value = Math.min(1, avgValue * 1.1); // Amplificar ligeramente
    } else {
      node.value = avgValue;
    }

    // Cap global de saturación
    node.value = Math.min(1, node.value);

    return node.value;
  }


  /**
   * Aplana el árbol para facilitar la búsqueda de nodos críticos.
   */
  public flatten(node: ImpactNode, results: ImpactNode[] = []): ImpactNode[] {
    results.push(node);
    if (node.children) {
      node.children.forEach(child => this.flatten(child, results));
    }
    return results;
  }

  /**
   * Obtiene los 3 problemas (nodos hoja) con mayor valor de impacto.
   */
  public getTopOffenders(rootNode: ImpactNode): ImpactNode[] {
    // Aplanamos y filtramos solo los nodos que no tengan hijos (causas raíz)
    const allLeaves = this.flatten(rootNode).filter(n => !n.children || n.children.length === 0);
    
    // Ordenamos de mayor a menor impacto y tomamos los 3 principales
    return allLeaves
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);
  }

}