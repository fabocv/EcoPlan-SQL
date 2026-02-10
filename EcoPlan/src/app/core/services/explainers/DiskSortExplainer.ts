import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { ExplanationContext, SuggestionExplainer, EvaluatedSuggestion } from "../SuggestionGen";

export class DiskSortExplainer implements SuggestionExplainer {

  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];

    // 1. Evidencia de uso de disco (Volumen)
    // Usamos metrics.tempFilesMb si está disponible, o buscamos en el plan
    if (metrics.tempFilesMb > 0) {
        evidence.push(`💾 Espacio en Disco: ${metrics.tempFilesMb.toFixed(2)} MB`);
    } else {
        // Fallback por si metrics no lo trajo pero el texto lo dice
        const diskMatch = plan.match(/Disk:\s*(\d+)\s*kB/);
        if (diskMatch) {
            const mb = (parseInt(diskMatch[1]) / 1024).toFixed(2);
            evidence.push(`💾 Espacio en Disco: ${mb} MB`);
        }
    }

    // 2. Método de Ordenamiento
    // Buscamos "Sort Method: external merge Disk: 240kB"
    const methodMatch = plan.match(/Sort Method:\s*([a-zA-Z\s]+)/i);
    if (methodMatch) {
        evidence.push(`⚙️ Estrategia: ${methodMatch[1].trim()}`); // Ej: "external merge"
    }

    // 3. Columnas implicadas (Sort Key)
    // Buscamos "Sort Key: t.create_date DESC"
    const sortKeyMatch = plan.match(/Sort Key:\s*(.+)/);
    if (sortKeyMatch) {
        // Limpiamos un poco el string (quitar alias largos si es necesario)
        let keys = sortKeyMatch[1].trim();
        if (keys.length > 50) keys = keys.substring(0, 47) + "...";
        evidence.push(`🔑 Ordenando por: ${keys}`);
    }

    return evidence;
  }

  buildExplanation(
    suggestion: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {
    const tempFiles = context.rawMetrics.tempFilesMb;
    
    // INTENTO DE ENCONTRAR LA CAUSA RAÍZ
    // 1. Identificar columnas de ordenamiento
    const sortKeyMatch = context.plan.match(/Sort Key:\s*(.+)/);
    const sortColumns = sortKeyMatch ? `**${sortKeyMatch[1].trim()}**` : "las columnas especificadas en ORDER BY";

    // 2. Determinar si es masivo o marginal
    const severityText = tempFiles > 50 
        ? "El volumen de datos desbordado es **CRÍTICO**." 
        : "El desbordamiento a disco está ralentizando la consulta.";

    return `
### 💾 Ordenamiento en Disco (Disk Sort)

La base de datos no tuvo suficiente memoria RAM (\`work_mem\`) para ordenar los resultados y tuvo que escribir archivos temporales en el disco.

#### 📉 Análisis de Impacto
El I/O de disco es significativamente más lento que la RAM.
- **Volumen escrito:** ${tempFiles.toFixed(2)} MB
- **Impacto:** Latencia alta y aumento de IOPS en el servidor.
- ${severityText}

#### ✅ Solución Recomendada
Tienes dos caminos principales para solucionar esto:

1.  **Indexación (Recomendado):**
    Crea un índice que ya esté ordenado por las columnas que necesitas. Esto elimina la operación de ordenamiento por completo.
    Columna(s) a indexar: ${sortColumns}

2.  **Aumentar Memoria (Paliativo):**
    Si no puedes crear índices, considera aumentar el parámetro \`work_mem\` para esta sesión o globalmente, para que el ordenamiento quepa en RAM.
    `.trim();
  }
}
