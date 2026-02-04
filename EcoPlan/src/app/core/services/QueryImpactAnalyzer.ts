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
  efficiencyScore: number; // 0 a 100
}

/**
 * Precios de referencia (Simulados para el Portfolio)
 * Basados en instancias promedio (ej. AWS r5.large)
 */
const CLOUD_RATES: Record<CloudProvider, CloudPricing> = {
  AWS:   { computeUnitCostPerMs: 0.000012, ioCostPerBuffer: 0.0000005 },
  GCP:   { computeUnitCostPerMs: 0.000010, ioCostPerBuffer: 0.0000004 },
  Azure: { computeUnitCostPerMs: 0.000011, ioCostPerBuffer: 0.0000006 }
};

// Extension para el calculo de sostenibilidad
interface GreenMetrics {
  co2Grams: number; // Gramos de CO2 producidos
  treeEquivalent: number; // Cuántos árboles se necesitarían para absorber esto en un día
}

const CARBON_INTENSITY = 0.475; // gCO2e por cada Wh (Promedio global)
const SERVER_WATTAGE = 250;     // Consumo promedio de un nodo de base de datos en Watts

@Injectable({
  providedIn: 'root' // Makes the service available throughout the app
})
export class QueryImpactAnalyzer {
  
  /**
   * Calcula el impacto económico y técnico
   * @param planText El texto del EXPLAIN ANALYZE
   * @param provider Proveedor de nube para el cálculo de costos
   * @param frequencyPerDay Cuántas veces se ejecuta esta query al día
   */
  public analyze(planText: string, provider: CloudProvider = 'AWS', frequencyPerDay: number = 1000): AnalysisResult {
    const timeMs = this.extractExecutionTime(planText);
    const buffers = this.extractBuffers(planText);
    const rowsRemoved = this.extractRowsRemoved(planText);
    
    const rates = CLOUD_RATES[provider];
    
    // Cálculo de impacto económico (Costo por ejecución * frecuencia diaria * 30 días)
    const costPerExecution = (timeMs * rates.computeUnitCostPerMs) + (buffers * rates.ioCostPerBuffer);
    const monthlyImpact = costPerExecution * frequencyPerDay * 30;

    const suggestions = this.generateSuggestions(planText, timeMs, rowsRemoved);
    
    return {
      executionTimeMs: timeMs,
      economicImpact: parseFloat(monthlyImpact.toFixed(2)),
      suggestions,
      efficiencyScore: this.calculateEfficiency(timeMs, rowsRemoved)
    };
  }

  /**
   * Calcula el impacto ambiental en CO2
   * @param executionTimeMs El tiempo de ejecucion obtenido del analyze
   * @param frequencyPerDay Cuántas veces se ejecuta esta query al día
   */
  public calculateEnvironmentalImpact(executionTimeMs: number, frequencyPerDay: number): GreenMetrics {
    const totalTimeHours = (executionTimeMs * frequencyPerDay * 30) / (1000 * 60 * 60);
    const totalKWh = (totalTimeHours * SERVER_WATTAGE) / 1000;
    
    const co2Grams = totalKWh * CARBON_INTENSITY;
    // Un árbol absorbe aprox 60g de CO2 al día
    const treeEquivalent = co2Grams / 60;

    return {
        co2Grams: parseFloat(co2Grams.toFixed(2)),
        treeEquivalent: parseFloat(treeEquivalent.toFixed(2))
    };
  }

  private extractExecutionTime(text: string): number {
    console.log(text)
    const regex = /Execution time:\s+([\d.]+)\s+ms/;
    const match = text.match(regex);
    console.log(match)
    return match ? parseFloat(match[1]) : 0;
  }

  private extractBuffers(text: string): number {
    const hitMatch = text.match(/shared hit=(\d+)/);
    const readMatch = text.match(/read=(\d+)/);
    return (hitMatch ? parseInt(hitMatch[1]) : 0) + (readMatch ? parseInt(readMatch[1]) : 0);
  }

  private slowestTable(text:string): {slowestTable:string, maxTime: number} {
    const scans = text.matchAll(/Seq Scan on (\w+).*actual time=[\d.]+\.\.([\d.]+)/g);
    let slowestTable = "";
    let maxTime = 0;

    for (const match of scans) {
      const tableTime = parseFloat(match[2]);
      if (tableTime > maxTime) {
          maxTime = tableTime;
          slowestTable = match[1];
      }
    }

    return {slowestTable:slowestTable, maxTime: maxTime}

  }

  private extractRowsRemoved(text: string): number {
    const matches = text.matchAll(/Rows Removed by Filter: (\d+)/g);
    let total = 0;
    for (const match of matches) {
      total += parseInt(match[1]);
    }
    return total;
  }

  private calculateEfficiency(time: number, removed: number): number {
    if (time === 0) return 100;
    // Una métrica simple: a más filas removidas y más tiempo, menor eficiencia
    const penalty = (removed / 10000) + (time / 100);
    return Math.max(0, Math.min(100, 100 - penalty));
  }

  private generateSuggestions(text: string, time: number, removed: number): string[] {
    const list: string[] = [];
    if (text.includes('Seq Scan') && removed > 10000) list.push("Critical: Missing Index detected.");
    if (text.includes('Disk:')) list.push("Memory: Work_mem spill to disk. Increase RAM allocation.");
    if (time > 1000) list.push("Architecture: Query time exceeds 1s. Evaluate partitioning.");
    const slowest = this.slowestTable(text);
    if (slowest) {
      list.push(`Performance: Table '${slowest.slowestTable}' is the main bottleneck (${slowest.maxTime}ms).`)
    }
    return list;
  }
}