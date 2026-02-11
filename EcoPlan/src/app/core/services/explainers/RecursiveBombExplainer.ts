import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { ExplanationContext, SuggestionExplainer, EvaluatedSuggestion } from "../SuggestionGen";

export class RecursiveBombExplainer implements SuggestionExplainer {

  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];

    // 1. Extraer profundidad
    const depthMatch = plan.match(/recursive[\s_]?depth[:=]\s*(\d+)/i);
    if (depthMatch) evidence.push(`🔄 Profundidad: ${depthMatch[1]}`);

    // 2. Extraer bucles
    const loopsMatch = plan.match(/loops=(\d+)/);
    if (loopsMatch) evidence.push(`🔁 Bucles: ${parseInt(loopsMatch[1]).toLocaleString()}`);

    // 3. Detectar tabla y condición (NUEVO)
    // Buscamos algo como "Hash Cond: (public.users.manager_id = recursive_cte.id)"
    const condMatch = plan.match(/(?:Hash|Merge) Cond:\s*\(([^)]+)\)/);
    if (condMatch) {
        // Limpiamos el string para que no sea tan largo
        const condition = condMatch[1].replace(/[a-z0-9_]+\./g, ''); // Quita los schemas/alias (ej: "manager_id = id")
        evidence.push(`🔗 Condición: ${condition}`);
    }

    return evidence;
  }

  buildExplanation(
    suggestion: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {
    const depth = context.rawMetrics.recursiveDepth || 10;
    const loops = context.rawMetrics.maxLoops || 100;
    
    // INTENTO DE ENCONTRAR LA COLUMNA CULPABLE
    // Buscamos la condición de unión en el texto crudo
    const joinMatch = context.plan.match(/(?:Hash|Merge) Cond:\s*\(([^)]+)\)/);
    
    // Si la encontramos, tratamos de aislar la columna de la izquierda o derecha
    let culpritColumn = "la columna de unión (ej: parent_id)";
    if (joinMatch) {
        // joinMatch[1] será algo como "t1.parent_id = t2.id"
        // Tomamos el texto y lo limpiamos para mostrarlo
        culpritColumn = `**${joinMatch[1]}**`; 
    }

    return `
### 💣 Bomba Recursiva Detectada

Hemos detectado una **CTE Recursiva** ineficiente.

#### 📉 Análisis de Impacto
La consulta realiza un **Sequential Scan** (lectura completa de tabla) en cada nivel de recursión.
- **Iteraciones:** ${loops.toLocaleString()}
- **Profundidad:** ${depth} niveles

#### ✅ Solución Recomendada
El motor está fallando al unir las filas padre con las filas hijo.

Debes crear un índice que cubra la condición:
${culpritColumn}

Al indexar esta columna, transformarás los escaneos secuenciales en **Index Seeks**, reduciendo el costo drásticamente.
    `.trim();
  }
}
