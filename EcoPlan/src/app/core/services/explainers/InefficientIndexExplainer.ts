import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { ExplanationContext, SuggestionExplainer, EvaluatedSuggestion } from "../SuggestionGen";

export class InefficientIndexExplainer implements SuggestionExplainer {

  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];

    // 1. CAPTURAR EL NOMBRE DEL ÍNDICE (Mejorado)
    // Busca "Index Scan using NOMBRE on TABLA"
    const indexMatch = plan.match(/Index Scan using\s+([^\s]+)/i);
    if (indexMatch) {
        evidence.push(`📇 Índice utilizado: **${indexMatch[1]}**`);
    }

    // 2. Evidencia de ineficiencia
    if (metrics.heapFetches && metrics.heapFetches > 0) {
        evidence.push(`⛏️ Accesos a Disco (Heap): ${metrics.heapFetches.toLocaleString()}`);
    }

    const removedMatch = plan.match(/Rows Removed by Filter:\s*(\d+)/);
    if (removedMatch) {
        const removed = parseInt(removedMatch[1]);
        evidence.push(`🗑️ Desperdicio: ${removed.toLocaleString()} filas leídas del índice pero descartadas`);
    }

    return evidence;
  }

  buildExplanation(
    suggestion: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {
    const plan = context.plan;
    
    // Extracción de datos para la narrativa
    const indexName = plan.match(/Index Scan using\s+([^\s]+)/)?.[1] || "el índice actual";
    const filterCond = plan.match(/Filter:\s*\((.+)\)/)?.[1] || "una condición no indexada";
    
    // Cálculo de impacto
    const rowsRemoved = context.rawMetrics.rowsRemovedByFilter || 0;
    const totalRead = context.rawMetrics.actualRows + rowsRemoved;
    const wastePercent = totalRead > 0 ? ((rowsRemoved / totalRead) * 100).toFixed(0) : "0";

    return `
### 📉 Índice Incompleto Detectado

El motor está utilizando el índice **${indexName}**, pero este no es suficiente para resolver la consulta por sí solo.

#### 🔍 El Problema
Aunque el índice ayuda a encontrar filas activas (\`Index Cond\`), no contiene la información necesaria para aplicar el filtro **${filterCond}**.
Esto obliga a PostgreSQL a:
1.  Leer el índice.
2.  Saltar a la tabla principal (Heap Fetch) para revisar el resto de columnas.
3.  Descartar el **${wastePercent}%** de lo que leyó.

#### ✅ Solución Recomendada
Debes **ampliar el índice** para cubrir la columna del filtro.

Si tu índice actual es \`(is_active)\`, cámbialo a un índice compuesto:
\`\`\`sql
CREATE INDEX ${indexName}_v2 ON users (is_active, country);
\`\`\`
*(Coloca primero la columna de igualdad exacta y luego la de rango/filtro).*

Esto permitirá un **Index Only Scan**, eliminando los ${context.rawMetrics.heapFetches?.toLocaleString() || 'miles de'} accesos a la tabla principal.
    `.trim();
  }
}
