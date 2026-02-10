import { ImpactNode } from "../ImpactTreeManager";
import { RawMetrics } from "../QueryImpactAnalyzer";
import { ExplanationContext, SuggestionExplainer, EvaluatedSuggestion } from "../SuggestionGen";

export class HighWasteExplainer implements SuggestionExplainer {

  extractEvidence(plan: string, metrics: RawMetrics): string[] {
    const evidence: string[] = [];

    // 1. Filas Descartadas (La evidencia principal)
    const removedMatch = plan.match(/Rows Removed by Filter: ([\d]+)/i);
    const removedCount = removedMatch ? parseInt(removedMatch[1]) : 0;
    
    if (removedCount > 0) {
        evidence.push(`🗑️ Filas descartadas: ${removedCount.toLocaleString()}`);
    }

    // 2. Condición de Filtro (El "Culpable")
    // Buscamos "Filter: ((status = 'active') AND (age > 25))"
    const filterMatch = plan.match(/Filter:\s*\((.+)\)/);
    if (filterMatch) {
        let filterCondition = filterMatch[1].trim();
        // Limpieza visual si es muy largo
        if (filterCondition.length > 60) {
            filterCondition = filterCondition.substring(0, 57) + "...";
        }
        evidence.push(`🔍 Condición aplicada: ${filterCondition}`);
    }

    // 3. I/O Desperdiciado
    // Si leyó muchos buffers pero devolvió poco, es relevante mostrarlo
    if (metrics.totalBuffersRead > 1000 && metrics.wasteRatio > 0.9) {
        evidence.push(`📉 I/O Intensivo: ${metrics.totalBuffersRead.toLocaleString()} buffers leídos`);
    }

    return evidence;
  }

  buildExplanation(
    suggestion: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {
    const m = context.rawMetrics;
    
    // Calcular porcentaje de desperdicio exacto para la narrativa
    // Nota: 'actualRows' son las que quedaron, necesitamos sumar las removidas para el total leído.
    const removedMatch = context.plan.match(/Rows Removed by Filter: ([\d]+)/i);
    const removed = removedMatch ? parseInt(removedMatch[1]) : 0;
    const totalRead = removed + m.actualRows;
    const wastePercent = totalRead > 0 ? ((removed / totalRead) * 100).toFixed(1) : "0";

    // Intentar extraer las columnas del filtro para la recomendación
    const filterMatch = context.plan.match(/Filter:\s*\((.+)\)/);
    const filterText = filterMatch ? `**${filterMatch[1]}**` : "las columnas utilizadas en el `WHERE`";

    return `
### 🧹 Alto Desperdicio de I/O (High Waste Scan)

La base de datos está leyendo una gran cantidad de datos solo para descartar la mayoría inmediatamente después.
Esto es el equivalente a **leer un libro entero para encontrar una sola frase**.

#### 📉 Análisis de Impacto
Estás filtrando los datos **después** de leerlos del disco, en lugar de usar un índice para ir directo a ellos.
- **Eficiencia de Lectura:** Solo el **${(100 - parseFloat(wastePercent)).toFixed(1)}%** de los datos leídos son útiles.
- **Desperdicio:** El **${wastePercent}%** de las filas fueron leídas y descartadas.
- **Costo:** CPU y I/O innecesarios procesando ${removed.toLocaleString()} filas basura.

#### ✅ Solución Recomendada
El motor necesita un camino directo a los datos.

Crea un índice (o un índice compuesto) que cubra:
${filterText}

Al indexar estas columnas, el motor saltará directamente a las filas que cumplen la condición, eliminando la carga de lectura masiva.
    `.trim();
  }
}
