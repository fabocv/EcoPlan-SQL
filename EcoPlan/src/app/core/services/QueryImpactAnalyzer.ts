// Script generado por Google Gemini v3 free

import { Injectable } from "@angular/core";

/**
 * Tipos de Nube Soportados
 */
export type CloudProvider = 'AWS' | 'GCP' | 'Azure';

interface CloudPricing {
  computeUnitCostPerMs: number; // Costo estimado por ms de CPU
  ioCostPerBuffer: number;      // Costo por cada 8kb (buffer) leído
}

export interface AnalysisResult {
  executionTimeMs: number;
  economicImpact: number;
  suggestions: {list: string[], solucion: string[]};
  efficiencyScore: number;
  provider: CloudProvider;
}

export const voidAnalysis: AnalysisResult = {
  executionTimeMs: 0,
  economicImpact: 0,
  suggestions: {list: [], solucion: []},
  efficiencyScore: 0,
  provider: 'AWS'
};

const CLOUD_RATES: Record<CloudProvider, CloudPricing> = {
  AWS:   { computeUnitCostPerMs: 0.000012, ioCostPerBuffer: 0.0000005 },
  GCP:   { computeUnitCostPerMs: 0.000010, ioCostPerBuffer: 0.0000004 },
  Azure: { computeUnitCostPerMs: 0.000011, ioCostPerBuffer: 0.0000006 }
};

@Injectable({
  providedIn: 'root'
})
export class QueryImpactAnalyzer {
  
  public analyze(planText: string, provider: CloudProvider = 'AWS', frequencyPerDay: number = 1000): AnalysisResult {
    const timeMs = this.extractExecutionTime(planText);
    const buffers = this.extractBuffers(planText);
    const rowsRemoved = this.extractRowsRemoved(planText);
    const rowsReturned = this.extractRowsReturned(planText);
    
    const rates = CLOUD_RATES[provider];
    
    // Artesanía Técnica: Si no hay buffers reales, estimamos el tráfico de I/O
    // basado en el volumen de filas procesadas para evitar costos de $0.
    const estimatedBuffers = buffers > 0 ? buffers : Math.ceil((rowsReturned + rowsRemoved) / 10);
    
    const costPerExecution = (timeMs * rates.computeUnitCostPerMs) + (estimatedBuffers * rates.ioCostPerBuffer);
    const monthlyImpact = costPerExecution * frequencyPerDay * 30;

    const suggestions: {list: string[], solucion: string[]} = this.generateSuggestions(planText, timeMs, rowsRemoved, rowsReturned);
    
    return {
      executionTimeMs: timeMs,
      economicImpact: parseFloat(monthlyImpact.toFixed(2)),
      suggestions,
      efficiencyScore: this.calculateEfficiency(timeMs, rowsRemoved, rowsReturned, planText),
      provider: provider
    };
  }

  private extractExecutionTime(text: string): number {
    // Regex flexible para "Execution time" o "Execution Time"
    const execMatch = text.match(/Execution [Tt]ime:\s+([\d.]+)\s+ms/);
    if (execMatch) return parseFloat(execMatch[1]);

    // Fallback: Si no está el tiempo final, buscar el tiempo del nodo raíz
    const rootTimeMatch = text.match(/\(actual time=[\d.]+\.\.([\d.]+)/);
    return rootTimeMatch ? parseFloat(rootTimeMatch[1]) : 0;
  }

  private extractRowsReturned(text: string): number {
    // Captura las filas del nodo principal (resultado final)
    const match = text.match(/actual time=.*?rows=(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractBuffers(text: string): number {
    const hitMatch = text.match(/shared hit=(\d+)/);
    const readMatch = text.match(/read=(\d+)/);
    return (hitMatch ? parseInt(hitMatch[1]) : 0) + (readMatch ? parseInt(readMatch[1]) : 0);
  }

  private extractRowsRemoved(text: string): number {
    const matches = Array.from(text.matchAll(/Rows Removed by Filter: (\d+)/g));
    return matches.reduce((acc, m) => acc + parseInt(m[1]), 0);
  }

  private calculateEfficiency(time: number, removed: number, returned: number, texto: string): number {
    if (time === 0) return 0;
  
    const totalProcessed = removed + returned;
    let score = 100;

    // Penalización por filas descartadas (Waste Ratio)
    if (totalProcessed > 0) {
      const wasteRatio = removed / totalProcessed;
      score -= (wasteRatio * 80); // Hasta 80 puntos menos por desperdicio masivo
    }

    // Penalización por Latencia
    score -= (time / 500) * 5; 

    // Penalización por Desbordamiento a Disco (Batches en Hash Join o Sort)
    const batchMatch = texto.match(/Batches: (\d+)/);
    if (batchMatch && parseInt(batchMatch[1]) > 1) {
      const batches = parseInt(batchMatch[1]);
      // Penalizamos 2 puntos por cada duplicación de batches (escala logarítmica)
      // 256 batches restarán aproximadamente 16-20 puntos adicionales.
      score -= Math.log2(batches) * 4;
    }

  return Math.max(0, Math.min(100, parseFloat(score.toFixed(2))));
  }

  private generateSuggestions(text: string, time: number, removed: number, returned: number): {list: string[], solucion: string[]} {
    const list: string[] = [];
    const solucion: string[] = [];

    const widthMatch = text.match(/width=(\d+)/);
    if (widthMatch) {
      const width = parseInt(widthMatch[1]);
      // Si el ancho es mayor a 100 bytes, es muy probable que haya columnas innecesarias
      if (width > 100 && returned > 1000) {
        list.push(`📏 Fila muy ancha (${width} bytes): Considera seleccionar solo las columnas necesarias. Reducir el ancho de fila ahorra energía en el bus de datos.`);
      }
    }
    
    if (text.includes('Seq Scan') && removed > returned) {
      list.push("⚠️ Seq Scan detectado: Se están descartando más filas de las que se devuelven. Falta un índice.");
    }

    if (text.includes('Disk:')) {
      list.push("💾 Memoria Crítica: Se usó el disco para ordenar. Sube el 'work_mem'.");
    }

    const hashMetrics: {batches: number, buckets: number, memoryUsedKb: number}| null = this.extractHashMetrics(text);
    // Detección de Memoria mejorada 
    const batchMatch = text.match(/Batches: (\d+)/);
    if (hashMetrics && batchMatch && parseInt(batchMatch[1]) > 1) {
      const recommendedMem = this.calculateNeededWorkMem(hashMetrics.batches, hashMetrics.memoryUsedKb);
      // Cálculo de exceso: batches es el multiplicador de insuficiencia
      const excessPercent = (hashMetrics.batches - 1) * 100;
      const currentLimit = `${hashMetrics.memoryUsedKb}kB`;
      
      list.push(`🚀 Optimización de Memoria: El Hash Join se desbordó a ${hashMetrics.batches} batches.`);
    
      list.push(`📏 Límite Superado: Los datos exceden en un ${excessPercent}% la capacidad de 'work_mem' actual (${currentLimit}). El límite ideal para esta consulta es de 1 batch.`);
      
      solucion.push(`💡 Acción: Incrementa 'work_mem' a al menos ${recommendedMem} para que toda la operación ocurra en RAM.`);
    } else if (text.includes('Disk:')) {
        solucion.push("Memoria: Se ha vertido la memoria de trabajo al disco. Aumentar la asignación de RAM.");
    }

    // Detección de Sorting en Disco
    const sortDiskMatch = text.match(/Disk:\s+(\d+)(kB|MB)/);
    if (sortDiskMatch) {
      list.push(`⚠️ Sort Externo: Se usó el disco para ordenar. Esto es lento y costoso energéticamente.`);
    }

    // la tabla más lenta
    const slowest = this.getSlowestTable(text);
    // Solo sugerir si la tabla consume más del 10% del tiempo total de ejecución
    if (slowest.name && slowest.maxTime > (time * 0.1)) {
      list.push(`🐢 Bottleneck Detectado: La tabla '${slowest.name}' consume ${((slowest.maxTime/time)*100).toFixed(1)}% del tiempo total.`);
    }

    if (text.includes('External merge') && text.includes('Disk:')) {
      const diskMatch = text.match(/Disk:\s+(\d+)(kB|MB)/);
      if (diskMatch) {
        list.push(`⚠️ Desborde en Ordenamiento: Se volcaron ${diskMatch[1]}${diskMatch[2]} a disco porque la 'work_mem' fue insuficiente para el Sort.`);
      }
    }

    if (text.includes('Nested Loop') && text.includes('Join Filter')) {
      const removedByJoin = text.match(/Rows Removed by Join Filter: (\d+)/);
      if (removedByJoin && parseInt(removedByJoin[1]) > 1000000) {
        list.push(`🚨 Alerta de Producto Cartesiano: Se detectó una comparación cruzada masiva (${parseInt(removedByJoin[1]).toLocaleString()} filas descartadas).`);
        list.push(`🔬 Análisis: El filtro '${text.match(/Join Filter: (.+)/)?.[1]}' está obligando a comparar casi todas las filas entre sí.`);
        solucion.push(`💡 Sugerencia: Revisa la lógica del JOIN. ¿Es realmente necesaria una desigualdad (>)? Si puedes usar una igualdad (=), el motor podrá usar un Hash Join mucho más eficiente.`);
      }
    }

    const loopsMatch = text.match(/loops=(\d+)/);
    if (loopsMatch && parseInt(loopsMatch[1]) > 10000) {
        list.push(`⚙️ Bucle de Alta Frecuencia: Un nodo se ejecutó ${parseInt(loopsMatch[1]).toLocaleString()} veces. Esto multiplica cualquier pequeña ineficiencia por un millón.`);
    }

    if (removed > 0 && returned > 0) {
      const wastePercent = ((removed / (removed + returned)) * 100).toFixed(2);
      if (parseFloat(wastePercent) > 90) {
        const filas = this.extractRowsRemoved(text);
        list.push(`🔥 Eficiencia Crítica: El ${wastePercent}% de los datos leídos fueron descartados.`);
        solucion.push(`💡 Solución: Crea un índice en la columna utilizada en el filtro para evitar el escaneo de ${filas}+ filas.`);
      }
    }

    if (text.includes('Limit') && text.includes('Seq Scan')) {
      list.push(`🛑 Trampa de Limit: Aunque pides pocos resultados, el motor escaneó la tabla completa antes de aplicar el límite. El ahorro de energía es nulo.`);
    }

    const filterCols = this.extractFilterColumns(text);
    const tableMatch = text.match(/Seq Scan on (\w+)/);
    const tableName = tableMatch ? tableMatch[1] : 'tabla';

    if (filterCols.length > 0) {
      const col = filterCols[0];
      solucion.push(`💡 Solución: Ejecuta 'CREATE INDEX idx_${tableName}_${col.replace('.', '_')} ON ${tableName} (${col});'. Esto reducirá el impacto de I/O.`);
    } else {
      solucion.push(`💡 Solución: Crea un índice en la columna utilizada en el filtro para evitar el escaneo masivo.`);
    }

    return {list: list, solucion: solucion};
  }

  /**
   * Calcula la memoria ideal basada en el número de batches y la memoria usada.
   * @param batches Número de fragmentos en los que se dividió el hash
   * @param currentMemoryKb Memoria reportada en el plan (el límite del work_mem actual)
   */
  private calculateNeededWorkMem(batches: number, currentMemoryKb: number): string {
    // Regla técnica: Para que entre en 1 batch, necesitamos (MemoriaActual * Batches).
    // Multiplicamos por 1.2 como "buffer" de seguridad para el optimizador.
    const safetyFactor = 1.2;
    const neededKb = currentMemoryKb * batches * safetyFactor;
    
    if (neededKb > 1024) {
      const mb = (neededKb / 1024).toFixed(1);
      return `${mb}MB`;
    }
    
    return `${Math.ceil(neededKb)}kB`;
  }

  /**
   * Extrae métricas detalladas del Hash Join
   */
  private extractHashMetrics(text: string): {batches: number, buckets: number, memoryUsedKb: number} | null {
    const match = text.match(/Buckets:\s+(\d+)\s+Batches:\s+(\d+)\s+Memory Usage:\s+(\d+)(kB|MB)/);
    if (!match) return null;

    return {
      buckets: parseInt(match[1]),
      batches: parseInt(match[2]),
      memoryUsedKb: match[4] === 'MB' ? parseInt(match[3]) * 1024 : parseInt(match[3])
    };
  }

  /**
   * Busca patrones como "Filter: (columna = ..." o "Index Cond: (columna = ..."
   * @text el string del usuario.
   */
  private extractFilterColumns(text: string): string[] {
    const filterMatch = text.match(/Filter: \(([\w.]+)/);
    if (filterMatch) {
      return [filterMatch[1]];
    }
    return [];
  }

  private getSlowestTable(text: string) {
    const scans = text.matchAll(/Seq Scan on (\w+).*actual time=[\d.]+\.\.([\d.]+)/g);
    let name = "";
    let maxTime = 0;

    for (const match of scans) {
      const time = parseFloat(match[2]);
      if (time > maxTime) {
        maxTime = time;
        name = match[1];
      }
    }
    return { name, maxTime };
  }
}