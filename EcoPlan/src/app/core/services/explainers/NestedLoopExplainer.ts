import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { SuggestionExplainer, EvaluatedSuggestion, ExplanationContext } from "../SuggestionGen";

export class NestedLoopExplainer implements SuggestionExplainer {
  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];
    const loopsMatch = plan.match(/loops=(\d+)/g);
    if (loopsMatch) {
      const totalLoops = loopsMatch.reduce((sum, m) => sum + parseInt(m.split('=')[1]), 0);
      evidence.push(`🔁 Loops detectados: ${totalLoops.toLocaleString()}`);
    }
    if (plan.includes('Nested Loop') && !plan.includes('Index Cond')) {
      evidence.push(`⚠️ Nested Loop SIN Index Cond (Seq Scan en loop)`);
    }
    const rowsMatch = plan.match(/rows=(\d+)/g);
    if (rowsMatch && rowsMatch.length > 1) {
      const outerRows = parseInt(rowsMatch[0].split('=')[1]);
      const innerRows = parseInt(rowsMatch[1].split('=')[1]);
      evidence.push(
        `📊 Producto cartesiano potencial: ${outerRows} × ${innerRows} = ${(outerRows * innerRows).toLocaleString()} filas`,
      );
    }
    return evidence;
  }
  buildExplanation(
    s: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext,
  ): string {
    return `## 🚨 Nested Loop IneficienteEl **${Math.round(node?.value ?? 0 * 100)}%** del impacto proviene de **${node?.label}**.### El Patrón PeligrosoUn **Nested Loop** sin índices es la peor estrategia posible:\`\`\`FOR EACH fila en tabla_externa (1M filas):  FOR EACH fila en tabla_interna (50K filas):    Aplicar join condition    Total: 1M × 50K = 50 BILLONES de comparaciones 🔥\`\`\`### Soluciones Ordenadas por Impacto1. **Agregar índice en la columna de JOIN** (mejor)2. **Forzar Hash Join**: \`SET enable_nestloop = off;\`3. **Revisar cardinalidades** en WHERE    `.trim();
  }
}
