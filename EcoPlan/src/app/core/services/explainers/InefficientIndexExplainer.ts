import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { SuggestionExplainer, ExplanationContext, EvaluatedSuggestion } from "../SuggestionGen";

// 2. INEFFICIENT INDEX (El caso de Heap Fetches)
export class InefficientIndexExplainer implements SuggestionExplainer {
  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const ev: string[] = [];
    if (metrics.heapFetches && metrics.heapFetches > 0) {
      ev.push(`📦 Saltos al Heap (Disco): ${metrics.heapFetches.toLocaleString()}`);
    }
    if (plan.includes('Rows Removed by Filter')) {
      ev.push(`🗑️ Filas descartadas post-lectura: Detectado`);
    }
    return ev;
  }

  buildExplanation(
      suggestion: EvaluatedSuggestion,
      node: ImpactNode | undefined,
      context: ExplanationContext
    ): string {
    const fetches = context.rawMetrics.heapFetches || 0;
    const rows = context.rawMetrics.actualRows || 1;
    const efficiency = ((rows / (fetches + rows)) * 100).toFixed(1);

    return `
### ⚠️ Índice "Mentiroso" (Ineficiente)

Aunque la consulta usa un índice, **está haciendo "doble trabajo"**.

#### 🔍 La Evidencia
El motor usa el índice para encontrar punteros, pero luego debe ir a la tabla principal (Heap) **${fetches.toLocaleString()} veces** para verificar columnas que no están en el índice, solo para descartar la mayoría de ellas.

#### 📊 Matemáticas del Desastre
- **Filas útiles:** ${rows}
- **Lecturas a disco:** ${fetches}
- **Eficiencia real del índice:** ${efficiency}%

**Solución:**
Necesitas un **Índice Cubriente (Covering Index)** o compuesto que incluya las columnas del \`WHERE\` o \`FILTER\`. Esto reduciría los Heap Fetches a cero.
    `.trim();
  }
}