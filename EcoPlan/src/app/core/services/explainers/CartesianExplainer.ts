import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { ExplanationContext, SuggestionExplainer, EvaluatedSuggestion } from "../SuggestionGen";

export class CartesianExplainer implements SuggestionExplainer {

  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];

    // 1. Detección del culpable (Nested Loop es el mecanismo usual para productos cartesianos)
    if (plan.includes("Nested Loop")) {
        evidence.push(`🔥 Estrategia: Nested Loop (Sin condición eficiente)`);
    } else if (plan.includes("Cross Join")) {
        evidence.push(`🔥 Estrategia: Cross Join Explícito`);
    }

    // 2. Volumen de filas (La evidencia del desastre)
    if (metrics.actualRows > 0) {
        evidence.push(`💥 Filas generadas: ${metrics.actualRows.toLocaleString()}`);
    }

    // 3. Estimación vs Realidad (Opcional, pero útil si el planner se equivocó)
    if (metrics.plannedRows > 0 && metrics.actualRows > metrics.plannedRows * 10) {
        evidence.push(`⚠️ Desviación: ${Math.round(metrics.actualRows / metrics.plannedRows)}x más filas de las esperadas`);
    }

    return evidence;
  }

  buildExplanation(
    suggestion: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {
    // Intentamos deducir si es una falta de condición JOIN
    const isImplicit = !context.plan.includes("CROSS JOIN");
    
    // Texto dinámico dependiendo de si parece un error o algo intencional que salió mal
    const causeText = isImplicit 
        ? "Parece que has olvidado una condición de unión (`ON` o `WHERE`) entre dos tablas."
        : "Estás realizando un `CROSS JOIN` que está generando demasiadas combinaciones.";

    return `
### ✖️ Producto Cartesiano Detectado

La consulta está combinando **cada fila** de una tabla con **cada fila** de otra tabla ($N \\times M$).
Esto genera un crecimiento exponencial de datos procesados.

#### 📉 Análisis de Impacto
El motor está realizando un trabajo innecesario masivo.
- **Multiplicación de Filas:** Si tienes 1,000 usuarios y 1,000 pedidos, ¡estás generando 1,000,000 de filas en memoria!
- **Saturación de CPU:** El procesador está al 100% intentando unir datos que no tienen relación.

#### ✅ Solución Recomendada
**${causeText}**

Revisa tus cláusulas \`JOIN\`:
1.  Asegúrate de que cada \`JOIN\` tenga su correspondiente \`ON tableA.id = tableB.fk_id\`.
2.  Si usas sintaxis antigua (tablas separadas por comas), verifica el \`WHERE\`.

Al agregar la condición de relación, reducirás el resultado de $N \\times M$ a solo $N$ filas relevantes.
    `.trim();
  }
}
