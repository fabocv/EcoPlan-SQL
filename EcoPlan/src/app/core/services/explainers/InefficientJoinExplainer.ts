import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { SuggestionExplainer, EvaluatedSuggestion, ExplanationContext } from "../SuggestionGen";

export class InefficientJoinExplainer implements SuggestionExplainer {
  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];

    // 1. Extraer filas eliminadas dinámicamente
    const removedMatch = plan.match(/Rows Removed by Join Filter:\s+(\d+)/);
    if (removedMatch) {
      const count = parseInt(removedMatch[1]);
      // Solo lo mostramos como evidencia si es significativo (> 0)
      if (count > 0) {
        evidence.push(`🗑️ Desperdicio CPU: **${count.toLocaleString()}** filas procesadas y descartadas.`);
      }
    }

    // 2. Extraer la condición del filtro
    const filterMatch = plan.match(/Join Filter:\s+\((.+)\)/);
    if (filterMatch) {
      evidence.push(`⚠️ Condición costosa: \`${filterMatch[1]}\``);
    }

    return evidence;
  }

  buildExplanation(
    s: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext,
  ): string {
    // A. Parseo Dinámico del Plan (fallback a valores por defecto si no matchea)
    const planText = context.plan || ""; // Asegúrate de que context tenga el plan
    
    // Parseo de filas eliminadas
    const removedMatch = planText.match(/Rows Removed by Join Filter:\s+(\d+)/);
    const rowsRemovedVal = removedMatch ? parseInt(removedMatch[1]) : 0;
    const rowsRemovedStr = rowsRemovedVal.toLocaleString();
    
    // Parseo de la condición
    const filterMatch = planText.match(/Join Filter:\s+\((.+)\)/);
    const filterCondition = filterMatch ? filterMatch[1] : "condición desconocida";

    // Detectar si es desigualdad (Triangular)
    const isTriangular = /[><]/.test(filterCondition) && !filterCondition.includes('=');
    const problemType = isTriangular ? "Join Triangular (Inequidad)" : "Filtrado Post-Join";

    const impactPercent = Math.round((node?.value ?? 0) * 100);

    return `
## 📉 Join Ineficiente (${problemType})
Este nodo contribuye al **${impactPercent}%** del impacto total. El problema es el **trabajo computacional desperdiciado**.

### 🔍 El Problema Detectado
Tu base de datos está realizando el trabajo sucio, pero tira los resultados a la basura al final.
1.  Ejecuta un Join (probablemente \`Nested Loop\`).
2.  Evalúa **${rowsRemovedStr}** combinaciones de filas en memoria.
3.  **Las descarta** porque no cumplen el filtro: \`${filterCondition}\`.

El costo de CPU se paga por cada una de esas **${rowsRemovedStr}** comparaciones fallidas.

\`\`\`sql
-- Tu ejecución real:
Nested Loop
  -> Join Filter: (${filterCondition})
  -> Rows Removed: ${rowsRemovedStr}  <-- ¡Aquí está el cuello de botella!
\`\`\`

### 🛠️ Soluciones Recomendadas

1.  **${isTriangular ? "Reemplazar Lógica Triangular" : "Optimizar Predicado"}**: 
    ${isTriangular 
      ? `Estás usando desigualdades (\`>\`, \`<\`) en un Join. Intenta usar **Window Functions** (\`LEAD\`, \`LAG\`) para calcular diferencias entre filas sin hacer un self-join.` 
      : `Intenta mover la condición \`${filterCondition}\` al \`WHERE\` de las subconsultas antes de hacer el join.`
    }
2.  **Índices Compuestos**: Crea un índice que cubra ambas columnas usadas en la condición: \`${filterCondition}\`.
3.  **Revisar Tipos de Datos**: Asegúrate de que ambos lados de la comparación sean del mismo tipo para evitar casteos implícitos que inhabilitan índices.
`.trim();
  }
}
