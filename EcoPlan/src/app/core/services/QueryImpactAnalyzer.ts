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
  suggestions: string[];
  efficiencyScore: number;
  provider: CloudProvider;
}

export const voidAnalysis: AnalysisResult = {
  executionTimeMs: 0,
  economicImpact: 0,
  suggestions: [],
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

    const suggestions = this.generateSuggestions(planText, timeMs, rowsRemoved, rowsReturned);
    
    return {
      executionTimeMs: timeMs,
      economicImpact: parseFloat(monthlyImpact.toFixed(2)),
      suggestions,
      efficiencyScore: this.calculateEfficiency(timeMs, rowsRemoved, rowsReturned),
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

  private calculateEfficiency(time: number, removed: number, returned: number): number {
    if (time === 0) return 0;
    const totalProcessed = removed + returned;
    if (totalProcessed === 0) return 100;

    const wasteRatio = removed / totalProcessed;
    // La eficiencia cae si hay mucho desperdicio de filas o latencia alta (>500ms)
    const score = (1 - wasteRatio) * 100 - (time / 500);
    return Math.max(0, Math.min(100, parseFloat(score.toFixed(2))));
  }

  private generateSuggestions(text: string, time: number, removed: number, returned: number): string[] {
    const list: string[] = [];
    
    if (text.includes('Seq Scan') && removed > returned) {
      list.push("⚠️ Seq Scan detectado: Se están descartando más filas de las que se devuelven. Falta un índice.");
    }

    if (text.includes('Disk:')) {
      list.push("💾 Memoria Crítica: Se usó el disco para ordenar. Sube el 'work_mem'.");
    }

    // Detección de Memoria mejorada 
    const batchMatch = text.match(/Batches: (\d+)/);
    if (batchMatch && parseInt(batchMatch[1]) > 1) {
        list.push(`⚠️ Memoria Insuficiente: Se detectaron ${batchMatch[1]} batches. El Hash Join se desbordó a disco. Incrementa 'work_mem'.`);
    } else if (text.includes('Disk:')) {
        list.push("Memory: Work_mem spill to disk. Increase RAM allocation.");
    }

    // la tabla más lenta
    const slowest = this.getSlowestTable(text);
    // Solo sugerir si la tabla consume más del 10% del tiempo total de ejecución
    if (slowest.name && slowest.maxTime > (time * 0.1)) {
      list.push(`🐢 Bottleneck Detectado: La tabla '${slowest.name}' consume ${((slowest.maxTime/time)*100).toFixed(1)}% del tiempo total.`);
    }

    return list;
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