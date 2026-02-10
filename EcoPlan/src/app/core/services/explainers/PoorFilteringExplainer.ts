import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { ExplanationContext, SuggestionExplainer, EvaluatedSuggestion } from "../SuggestionGen";

export class PoorFilteringExplainer implements SuggestionExplainer {

  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];

    // 1. Detectar filas descartadas (La prueba reina del desperdicio)
    // Postgres suele mostrar: "Rows Removed by Filter: 12345"
    const removedMatch = plan.match(/Rows Removed(?: by Filter)?:\s*(\d+)/i);
    if (removedMatch) {
      const removedCount = parseInt(removedMatch[1]);
      evidence.push(`🗑️ Filas descartadas: ${removedCount.toLocaleString()}`);
    }

    // 2. Detectar la condición de filtrado
    // Ej: "Filter: ((cantidad > 100) AND (estado = 'activo'))"
    const filterMatch = plan.match(/Filter:\s*\(([^)]+)\)/);
    if (filterMatch) {
       // Limpiamos alias complejos ej: "t1.estado" -> "estado"
       const cleanFilter = filterMatch[1].replace(/[a-z0-9_]+\./g, ''); 
       evidence.push(`🔍 Filtro aplicado: ${cleanFilter}`);
    }

    // 3. Detectar tabla escaneada (Scan Type)
    // Ej: "Seq Scan on users"
    const scanMatch = plan.match(/(Seq Scan|Index Scan|Bitmap Heap Scan) on\s+([a-zA-Z0-9_.]+)/);
    if (scanMatch) {
      evidence.push(`📄 Tabla afectada: ${scanMatch[2]} (${scanMatch[1]})`);
    }

    return evidence;
  }

  buildExplanation(
    suggestion: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {
    // Intentamos extraer datos numéricos del plan para el mensaje
    const removedMatch = context.plan.match(/Rows Removed(?: by Filter)?:\s*(\d+)/i);
    const removedCount = removedMatch ? parseInt(removedMatch[1]) : 0;
    
    // Identificar el filtro culpable
    const filterMatch = context.plan.match(/Filter:\s*\((.+)\)/);
    let culpritCondition = filterMatch ? filterMatch[1] : "la condición WHERE";

    // Si podemos identificar la tabla
    const tableMatch = context.plan.match(/on\s+([a-zA-Z0-9_.]+)/);
    const tableName = tableMatch ? tableMatch[1] : "la tabla";

    return `
### 🛁 Filtrado Ineficiente Detectado

La consulta está desperdiciando recursos de I/O y CPU leyendo filas que luego descarta.

#### 📉 Análisis de Impacto
El motor de base de datos tuvo que leer y procesar datos, pero descartó **${removedCount > 0 ? removedCount.toLocaleString() : 'un gran volumen de'} filas** porque no cumplían con tu filtro.

Esto suele indicar que **${tableName}** está siendo escaneada secuencialmente (Full Table Scan) o que el índice usado no cubre todas las columnas del filtro.

#### ✅ Solución Recomendada
Revisa los índices para la siguiente condición:

\`\`\`sql
WHERE ${culpritCondition}
\`\`\`

1. **Crea un índice** que incluya las columnas mencionadas en el filtro.
2. Si usas funciones en las columnas (ej: \`YEAR(fecha)\`), cámbialas por rangos para que el índice sea utilizable (**SARGable**).
    `.trim();
  }
}
