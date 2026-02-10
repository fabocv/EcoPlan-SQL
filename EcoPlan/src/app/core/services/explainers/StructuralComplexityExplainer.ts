import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { ExplanationContext, SuggestionExplainer, EvaluatedSuggestion } from "../SuggestionGen";

export class StructuralComplexityExplainer implements SuggestionExplainer {

  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];

    // 1. Profundidad del árbol (Depth)
    if (metrics.maxDepth && metrics.maxDepth > 5) {
        evidence.push(`🌳 Profundidad del Árbol: ${metrics.maxDepth} niveles`);
    }

    // 2. Presencia de SubPlanes (indicador de complejidad lógica)
    // Buscamos "SubPlan" o "InitPlan" en el texto crudo
    const subPlanCount = (plan.match(/SubPlan/g) || []).length;
    const initPlanCount = (plan.match(/InitPlan/g) || []).length;

    if (subPlanCount > 0) {
        evidence.push(`🕸️ SubConsultas (SubPlans): ${subPlanCount} detectados`);
    }
    if (initPlanCount > 0) {
        evidence.push(`🎬 Inicializadores (InitPlans): ${initPlanCount} detectados`);
    }

    // 3. Cantidad de Joins
    // Contamos palabras clave de Join para dar contexto de volumen
    const joinCount = (plan.match(/Join/g) || []).length;
    if (joinCount > 3) {
        evidence.push(`🔗 Uniones (Joins): ${joinCount} tablas involucradas`);
    }

    return evidence;
  }

  buildExplanation(
    suggestion: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {
    const depth = context.rawMetrics.maxDepth || 0;
    const hasSubPlans = (context.plan.match(/SubPlan/g) || []).length > 0;

    // Determinar severidad del mensaje
    const complexityTitle = depth > 8 || hasSubPlans 
        ? "La estructura es **altamente compleja** y difícil de optimizar."
        : "La estructura muestra signos de anidamiento innecesario.";

    return `
### 🧶 Complejidad Estructural (Structural Complexity)

El optimizador de base de datos tiene dificultades para encontrar el mejor camino de ejecución debido a la forma en que está escrita la consulta.

#### 📉 Análisis de Impacto
Una estructura compleja impide que el motor reordene los JOINs eficientemente o use índices compuestos.
- **Niveles de Profundidad:** ${depth}
- **Riesgo:** ${complexityTitle}
- **Efecto:** El tiempo de planificación (Planning Time) aumenta y la ejecución se vuelve impredecible.

#### ✅ Solución Recomendada
Simplifica la arquitectura de la consulta:

1.  **Aplanar con CTEs (WITH):**
    Mueve las subconsultas complejas o lógica anidada a un \`WITH clause\` al inicio. Esto hace la query más legible y a veces ayuda al optimizador (o usa \`MATERIALIZED\` si es necesario).

2.  **Eliminar SubPlans:**
    Si ves "SubPlan" en la evidencia, intenta transformar esas subconsultas (generalmente en el \`SELECT\` o \`WHERE\`) en **LEFT JOINs**.
    `.trim();
  }
}
