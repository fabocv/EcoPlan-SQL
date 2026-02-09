import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { SuggestionExplainer, ExplanationContext, EvaluatedSuggestion } from "../SuggestionGen";

export class WorkMemExplainer implements SuggestionExplainer {
  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];
    
    const batchesMatch = plan.match(/Batches: (\d+)/);
    if (batchesMatch && parseInt(batchesMatch[1]) > 1) {
      evidence.push(`📦 Batches en disco: ${batchesMatch[1]}`);
    }

    if (plan.includes('External sort')) {
      evidence.push(`💾 External merge sort detectado`);
    }

    if (metrics.tempFilesMb > 0) {
      evidence.push(`🗂️ Espacio temporal usado: ${metrics.tempFilesMb.toFixed(2)} MB`);
    }

    const suggestedWorkMem = Math.max(
      64,
      Math.ceil(metrics.tempFilesMb * 1.5 / 32) * 32
    );
    evidence.push(`⚙️ Valor sugerido: work_mem = ${suggestedWorkMem}MB`);

    return evidence;
  }

  buildExplanation(
    s: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {
    const tempFilesMb = context.rawMetrics.tempFilesMb || 0;
    const suggestedMem = Math.max(
      64,
      Math.ceil(tempFilesMb * 1.5 / 32) * 32
    );

    return `
## 🔧 Insuficiencia de Memoria (work_mem)

El **${Math.round(node?.value ?? 0 * 100)}%** del impacto proviene de **${node?.label}**.

### El Problema
PostgreSQL necesita ordenar/agrupar **${tempFilesMb.toFixed(2)} MB** de datos,
pero tu \`work_mem\` es insuficiente. El motor está usando **disco** como respaldo.

### Degradación de Performance
- RAM (rápida): ~100,000 ops/seg
- Disco (lenta): ~1,000 ops/seg (100x más lento)

Con **${tempFilesMb.toFixed(2)} MB** en disco, pierdes **${Math.round((tempFilesMb / 1024) * 100)}%** de eficiencia.

### Solución
Incrementa \`work_mem\` a **${suggestedMem} MB** en postgresql.conf:
\`\`\`
work_mem = ${suggestedMem}MB
\`\`\`

(O por sesión: \`SET work_mem = '${suggestedMem}MB';\`)
    `.trim();
  }
}

class NestedLoopExplainer implements SuggestionExplainer {
  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];

    const loopsMatch = plan.match(/loops=(\d+)/g);
    if (loopsMatch) {
      const totalLoops = loopsMatch.reduce((sum, m) => 
        sum + parseInt(m.split('=')[1]), 0
      );
      evidence.push(`🔁 Loops detectados: ${totalLoops.toLocaleString()}`);
    }

    if (plan.includes('Nested Loop') && !plan.includes('Index Cond')) {
      evidence.push(`⚠️ Nested Loop SIN Index Cond (Seq Scan en loop)`);
    }

    const rowsMatch = plan.match(/rows=(\d+)/g);
    if (rowsMatch && rowsMatch.length > 1) {
      const outerRows = parseInt(rowsMatch[0].split('=')[1]);
      const innerRows = parseInt(rowsMatch[1].split('=')[1]);
      evidence.push(`📊 Producto cartesiano potencial: ${outerRows} × ${innerRows} = ${(outerRows * innerRows).toLocaleString()} filas`);
    }

    return evidence;
  }

  buildExplanation(
    s: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {
    return `
## 🚨 Nested Loop Ineficiente

El **${Math.round(node?.value ?? 0 * 100)}%** del impacto proviene de **${node?.label}**.

### El Patrón Peligroso
Un **Nested Loop** sin índices es la peor estrategia posible:

\`\`\`
FOR EACH fila en tabla_externa (1M filas):
  FOR EACH fila en tabla_interna (50K filas):
    Aplicar join condition
    
Total: 1M × 50K = 50 BILLONES de comparaciones 🔥
\`\`\`

### Soluciones Ordenadas por Impacto
1. **Agregar índice en la columna de JOIN** (mejor)
2. **Forzar Hash Join**: \`SET enable_nestloop = off;\`
3. **Revisar cardinalidades** en WHERE
    `.trim();
  }
}
