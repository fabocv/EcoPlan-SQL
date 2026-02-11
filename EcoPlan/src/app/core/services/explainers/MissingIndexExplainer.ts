import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { ExplanationContext, SuggestionExplainer, EvaluatedSuggestion } from "../SuggestionGen";

export class MissingIndexExplainer implements SuggestionExplainer {

  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];

    // 1. Identificar tabla y tipo de escaneo
    const scanMatch = plan.match(/(?:Parallel\s+)?Seq Scan on\s+([^\s]+)/i);
    if (scanMatch) {
      const isParallel = plan.includes('Parallel');
      evidence.push(`🔍 Escaneo Completo: **${scanMatch[1]}** ${isParallel ? '(Paralelo)' : ''}`);
    }

    // 2. Filas Descartadas (Waste)
    if (metrics.rowsRemovedByFilter && metrics.rowsRemovedByFilter > 0) {
      const percent = metrics.actualRows > 0 
        ? Math.round((metrics.rowsRemovedByFilter / (metrics.actualRows + metrics.rowsRemovedByFilter)) * 100)
        : 100;
      evidence.push(`🗑️ Desperdicio: ${metrics.rowsRemovedByFilter.toLocaleString()} filas (${percent}%)`);
    }

    // 3. JSON Check
    if (plan.includes('->') || plan.includes('->>')) {
      evidence.push(`🧱 Acceso a estructura JSON detectado`);
    }

    // 4. JIT Warning
    const jitMatch = plan.match(/JIT:[\s\S]+?Total\s+([\d\.]+)\s+ms/);
    if (jitMatch && parseFloat(jitMatch[1]) > 50) {
      evidence.push(`⏱️ Sobrecarga JIT: ${parseFloat(jitMatch[1]).toFixed(0)}ms (Compilación)`);
    }

    return evidence;
  }

  buildExplanation(
    suggestion: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {
    const plan = context.plan || '';
    
    // --- 1. Extracción de Datos Críticos ---
    const tableMatch = plan.match(/(?:Parallel\s+)?Seq Scan on\s+([^\s]+)/i);
    const tableName = tableMatch ? tableMatch[1] : "tabla_desconocida";
    
    // Extracción limpia del filtro
    const filterMatch = plan.match(/Filter:\s*\((.+)\)/);
    let rawFilter = filterMatch ? filterMatch[1] : "";

    // --- 2. Análisis Inteligente del Filtro ---
    const indexSuggestions: string[] = [];
    let isJson = false;
    let complexityDesc = "";

    if (rawFilter) {
      // Limpiar casteos molestos de Postgres (ej: ::text, ::integer)
      rawFilter = rawFilter.replace(/::[a-zA-Z0-9_]+/g, '');

      // Intentar dividir por AND para sugerir índices compuestos (lógica simple)
      // Nota: Esto es heurístico, un parser SQL real sería ideal, pero esto cubre el 90% de casos
      const conditions = rawFilter.split(/\s+AND\s+/i);
      
      const columnsToIndex: string[] = [];

      conditions.forEach(cond => {
        // Extraer el lado izquierdo de la operación (ej: "age > 18" -> "age")
        // Regex busca algo antes de un operador común (=, <, >, LIKE, IS, ~)
        const parts = cond.split(/(=|<>|<|>|\sIS\s|\sIN\s|\sLIKE\s|\s~\*?)/i);
        if (parts.length > 1) {
          let col = parts[0].trim();
          
          // Limpiar paréntesis externos residuales
          while (col.startsWith('(') && !col.includes('->')) col = col.substring(1); 
          
          // Detectar JSON
          if (col.includes('->')) {
            isJson = true;
            // Para JSON (expresión), necesitamos envolver en paréntesis dobles en el CREATE INDEX
            columnsToIndex.push(`(${col})`); 
          } else {
            columnsToIndex.push(col);
          }
        }
      });

      if (columnsToIndex.length > 0) {
        // Generar nombre de índice seguro (sin puntos ni chars raros)
        const safeTableName = tableName.replace(/\./g, '_').replace(/\W/g, '');
        const colsSafeName = columnsToIndex.map(c => c.replace(/\W/g, '').substring(0, 10)).join('_');
        
        indexSuggestions.push(`
CREATE INDEX CONCURRENTLY idx_${safeTableName}_${colsSafeName}
ON ${tableName} (${columnsToIndex.join(', ')});
        `.trim());
        
        if (columnsToIndex.length > 1) {
          complexityDesc = `Se detectaron **${columnsToIndex.length} condiciones**. Se sugiere un **Índice Compuesto** para máxima eficiencia.`;
        } else if (isJson) {
           complexityDesc = `Se detectó acceso a propiedades **JSON**. Se requiere un índice de expresión.`;
        } else {
           complexityDesc = `La columna **${columnsToIndex[0]}** se usa para filtrar pero no está indexada.`;
        }
      }
    }

    // Fallback si no pudimos parsear el filtro
    if (indexSuggestions.length === 0) {
        complexityDesc = "El filtro es complejo. Se recomienda indexar las columnas usadas en la cláusula WHERE.";
        indexSuggestions.push(`-- Crea un índice en ${tableName} basado en tu WHERE:\n-- ${rawFilter.substring(0, 50)}...`);
    }

    // --- 3. Construcción del Markdown ---
    const rowsRemoved = context.rawMetrics.rowsRemovedByFilter || 0;
    const wasteFormatted = rowsRemoved.toLocaleString();
    
    // Título dinámico
    const titleType = isJson ? "(JSON)" : (indexSuggestions[0].includes(',') ? "(Compuesto)" : "");

    return `
### 🕵️ Falta de Índice ${titleType}

**La base de datos está leyendo la tabla completa (${tableName}) fila por fila.**

#### 📉 Análisis de Impacto
${complexityDesc}

*   **Desperdicio I/O:** El motor leyó y descartó **${wasteFormatted} filas**.
*   **Saturación de Caché:** Estás llenando la memoria RAM con datos inútiles, expulsando datos que sí importan.

#### ✅ Solución Recomendada (Copiar y Pegar)
${indexSuggestions.length > 1 ? 'Elige la opción que mejor se adapte a tus patrones de consulta:' : ''}

\`\`\`sql
${indexSuggestions.join('\n\n-- O --\n\n')}
\`\`\`

> **Nota:** Si la tabla es muy grande (millones de filas), usa \`CONCURRENTLY\` para evitar bloquear la base de datos durante la creación.
    `.trim();
  }
}
