// Script generado por Google Gemini v3 free

import { inject, Injectable } from "@angular/core";
import { ImpactNode, ImpactTreeManager, SmartAnalysisResult } from "./ImpactTreeManager";
import { StructuralFlags, SuggestionContext, SuggestionGenerator } from "./SuggestionGenerator";

/**
 * Tipos de Nube Soportados
 */
export type CloudProvider = 'AWS' | 'GCP' | 'Azure';


interface CloudPricing {
  computeUnitCostPerMs: number; // Costo estimado por ms de CPU
  ioCostPerBuffer: number;      // Costo por cada 8kb (buffer) leído
}
/**
 * COEFICIENTES DE INTENSIDAD ENERGÉTICA (Basados en literatura de Green IT)
 * Ref 1: "Energy consumption in data centers", Koomey et al.
 * Ref 2: "PostgreSQL Guide to I/O costs".
 */
const ENERGY_COEFFICIENTS = {
  SHARED_HIT: 0.1,    // RAM: Muy eficiente.
  SHARED_READ: 1.0,   // DISCO: Referencia base (1.0).
  LOCAL_READ: 0.8,    // TEMP RAM: Memoria local de proceso, ligeramente más cara que shared.
  TEMP_IO: 1.5        // DISCO TEMP: El swap a disco (Spill) es la operación más costosa.
};

const CLOUD_RATES: Record<CloudProvider, CloudPricing> = {
  AWS:   { computeUnitCostPerMs: 0.000012, ioCostPerBuffer: 0.0000005 },
  GCP:   { computeUnitCostPerMs: 0.000010, ioCostPerBuffer: 0.0000004 },
  Azure: { computeUnitCostPerMs: 0.000011, ioCostPerBuffer: 0.0000006 }
};

export interface RawMetrics {
  executionTime: number;
  execTimeInExplain: boolean;
  planningTime: number;
  jitTime: number;
  batches: number;
  hasDiskSort: boolean;
  tempFilesMb: number;
  totalBuffersRead: number;
  wasteRatio: number;
  isCartesian: boolean;
  workers: number;
  recursiveDepth: number;
  maxLoops: number;
  rowsPerIteration: number;
  seqScanInLoop: boolean,
  plannedRows: number;
  actualRows: number;
  heapFetches: number;
}

@Injectable({
  providedIn: 'root'
})
export class QueryImpactAnalyzer {

  private treeManager = new ImpactTreeManager();
  private suggestionGenerator = inject(SuggestionGenerator);

  /**
  * Este es el "Director de Orquesta" que une el extractor, 
  * el manager del árbol y el generador de sugerencias.
  */
  public analyzePlan(plan: string, provider:CloudProvider, frequency: number = 1): SmartAnalysisResult {
    // 1. FASE DE EXTRACCIÓN (Raw Metrics)
    const metrics = this.extractAllMetrics(plan);

    // Cálculo de Drift (Desviación): Si el planner estimó 10 filas y vinieron 1M, o viceversa.
    // Un factor de 10x se considera drift grave.
    const driftFactor = metrics.plannedRows > 0 
      ? Math.abs(metrics.actualRows - metrics.plannedRows) / metrics.plannedRows 
      : 0;

    const structuralFlag: StructuralFlags = {
        // Join & Loops
        hasNestedLoop: plan.includes('Nested Loop'),
        hasCartesianProduct: metrics.isCartesian, // Ya lo calculas en metrics
        hasSeqScanInLoop: metrics.seqScanInLoop,
        hasJoin: plan.toUpperCase().includes('JOIN'),

        // Recursion & Materialization
        hasRecursiveCTE: metrics.recursiveDepth > 0,
        hasForcedMaterialization: plan.includes('Materialize'),

        // Planner Quality
        hasRowEstimateDrift: driftFactor > 10, // Si le erró por 10x
        hasLateFiltering: plan.includes('Filter') && !plan.includes('Index Cond'), // Heurística simple

        // Memory & IO
        hasExternalSortOrHash: metrics.hasDiskSort, 

        // Parallelism
        hasWorkerStarvation: metrics.workers < 1 && plan.includes('Workers Planned')
      }
    // 2. FASE ESTRUCTURAL (Impact Tree)

    console.table(metrics)
    console.table(structuralFlag)
    const impactTree = this.buildEcoSQLTree(metrics, structuralFlag); 
    
    

    // 3. FASE DE CONTEXTO
    const manager = new ImpactTreeManager();
    const dominantNodes = manager.getTopOffenders(impactTree);
    const impactSaturation = 1 - Math.max(...dominantNodes.map(n => n.value));

    const context: SuggestionContext = {
      impactTree: impactTree,
      dominantNodes: dominantNodes,
      rawMetrics: metrics,
      structuralFlags: structuralFlag,
      impactSaturation: impactSaturation
    };

    // 4. LLAMADA AL GENERADOR 
    const evaluatedSuggestions = this.suggestionGenerator.generateSmartSuggestions(context, plan);

    // 5. ENSAMBLE FINAL
    return {
      executionTimeMs: metrics.executionTime,
      economicImpact: this.calculateEconomicImpact(metrics, frequency, provider),
      efficiencyScore: (1 - impactTree.value) * 100, // Efficiency Score basado en el árbol resuelto
      suggestions: {
        list: evaluatedSuggestions.map(s => s.title),
        solucion: evaluatedSuggestions.map(s => s.recommendation)
      },
      provider: 'AWS',
      execTimeInExplain: metrics.execTimeInExplain,
      impactTree: impactTree,
      topOffenders: context.dominantNodes,
      breakdown: `Análisis completado. Eficiencia del ${((1 - impactTree.value) * 100).toFixed(2)}%.`
    };
  }


  /**
   * Calcula el impacto económico proyectado (USD) incluyendo la frecuencia de ejecución.
   * @param metrics Métricas crudas del explain
   * @param frequency Ejecuciones por periodo (ej: por día)
   * @param provider Proveedor de nube seleccionado
   */
  calculateEconomicImpact(
    metrics: RawMetrics, 
    frequency: number = 1, // Por defecto 1 ejecución
    provider: CloudProvider = 'AWS'
  ): number {
    const rate = CLOUD_RATES[provider];
    
    // 1. Costo Base por Ejecución (Compute + I/O Ponderado)
    const computeCost = metrics.executionTime * rate.computeUnitCostPerMs;
    
    // Aplicamos ENERGY_COEFFICIENTS para penalizar el uso de Swap/Temp
    const weightedIO = (metrics.totalBuffersRead * ENERGY_COEFFICIENTS.SHARED_READ) + 
                      (metrics.tempFilesMb * 128 * ENERGY_COEFFICIENTS.TEMP_IO);
                      
    const ioCostPerExec = weightedIO * rate.ioCostPerBuffer;

    // 2. Multiplicador de Riesgo Estructural
    // Penalizamos un 20% extra si hay patrones de alto riesgo como Cartesian o SeqScan en loops
    const structuralRiskFee = metrics.isCartesian || metrics.seqScanInLoop ? 1.2 : 1.0;

    // 3. Cálculo Final Escaleado por Frecuencia
    const totalCostPerExec = (computeCost + ioCostPerExec) * structuralRiskFee;
    
    return totalCostPerExec * frequency;
  }

  extractAllMetrics(plan: string): RawMetrics {
    const planUpper = plan.toUpperCase();
    
    // 3. Estructurales y Bucles
    const loopsMatch = plan.match(/loops=(\d+)/g);
    const maxLoops = loopsMatch 
      ? Math.max(...loopsMatch.map(m => parseInt(m.split('=')[1]))) 
      : 1;

    // 4. Desperdicio (Waste Ratio)
    const rowsRemoved = parseInt(plan.match(/Rows Removed by Filter: (\d+)/i)?.[1] || "0");
    const actualRows = parseInt(plan.match(/actual rows=(\d+)/i)?.[1] || "0");

    // 5. Flags de Criticidad (v0.9.x)
    const isRecursive = planUpper.includes('RECURSIVE UNION');

    const {execTime, execTimeInExplain} = this.getExecutionTimeAndExplain(plan)

    // Regex para capturar filas estimadas (rows=N) y reales (actual rows=N)
    // Nota: El primer match suele ser el nodo raíz, que es el importante para el global.
    const plannedRowsMatch = plan.match(/rows=(\d+)/); 

    const plannedRows = plannedRowsMatch ? parseInt(plannedRowsMatch[1]) : 0;

    const totalRowsRead = (rowsRemoved + actualRows);

    const batches = parseInt(plan.match(/Batches: (\d+)/i)?.[1] || "1");
    const hasDiskSort = batches > 1 || plan.includes('Disk') || plan.includes('External sort');

    return {
      executionTime: execTime,
      execTimeInExplain: execTimeInExplain,
      planningTime: parseFloat(plan.match(/Planning time: ([\d.]+) ms/i)?.[1] || "0"),
      jitTime: parseFloat(plan.match(/JIT:[\s\S]*?Total: ([\d.]+) ms/i)?.[1] || "0"),
      batches: batches,
      hasDiskSort: hasDiskSort,
      tempFilesMb: parseFloat(plan.match(/Storage: ([\d.]+)kB/i)?.[1] || "0") / 1024,
      totalBuffersRead: parseInt(plan.match(/shared read=(\d+)/i)?.[1] || "0") + 
                        parseInt(plan.match(/local read=(\d+)/i)?.[1] || "0"),
      wasteRatio: totalRowsRead > 0 
        ? (rowsRemoved / totalRowsRead) * Math.min(1, Math.log10(totalRowsRead) / 5) 
        : 0,
      isCartesian: planUpper.includes('JOIN FILTER') || (planUpper.includes('NESTED LOOP') && maxLoops > 100),
      workers: parseInt(plan.match(/Workers Launched: (\d+)/i)?.[1] || "0"),
      recursiveDepth: isRecursive ? 10 : 0, // Umbral crítico definido en v0.9.x
      maxLoops: maxLoops,
      rowsPerIteration: actualRows / maxLoops,
      seqScanInLoop: isRecursive && planUpper.includes('SEQ SCAN'),
      actualRows: actualRows,
      plannedRows: plannedRows,
      heapFetches: parseInt(plan.match(/Heap Fetches: (\d+)/)?.[1] || "0"),
    };
  }

  private getExecutionTimeAndExplain(plan: string): {execTime:number, execTimeInExplain: boolean} {
    // 1. Tiempos (ms) - Obtención de tiempo de ejecución bajo 3 escenarios
    //escenario 1: esta declarado en el plan text
    let execTime = this.parseFloatFromRegex(plan, /Execution [Tt]ime: ([\d.]+)/) || 0;

    // escenario 2
    if (execTime === 0) {
      // Buscamos el primer "actual time=XX.XX..YY.YYY" y tomamos el segundo valor (el final)
      const rootActualTimeMatch = plan.match(/actual time=[\d.]+\.\.([\d.]+)/);
      if (rootActualTimeMatch) {
        execTime = parseFloat(rootActualTimeMatch[1]);
      }
    }
    //(Escenario 3): Si sigue siendo 0 (es un EXPLAIN sin ANALYZE),
    // tomamos el COSTO superior como una métrica de tiempo referencial (opcional)
    if (execTime === 0) {
      const costMatch = plan.match(/cost=[\d.]+\.\.([\d.]+)/);
      if (costMatch) {
        // El costo no es tiempo, pero para efectos de score nos da una magnitud
        execTime = parseFloat(costMatch[1]) / 100; 
      }
    }

    // si todo falla el valor mínimo será 0.01

    const execTimeInExplain = execTime > 0
    execTime = execTimeInExplain ? execTime : 0.01;

    return {execTime:execTime, execTimeInExplain: execTimeInExplain}
  }

  /** * Helpers de extracción 
   */
  private parseFloatFromRegex(text: string, regex: RegExp): number {
    const match = text.match(regex);
    return match ? parseFloat(match[1]) : 0;
  }

  buildEcoSQLTree(metrics: RawMetrics, structuralFlags: StructuralFlags): ImpactNode {
    const manager = new ImpactTreeManager();

    const root: ImpactNode = {
      id: 'query_impact',
      label: 'Total Query Impact',
      weight: 1.0,
      value: 0,
      description: 'Impacto global...',
      children: [
        {
          id: 'perf',
          label: 'Performance Impact',
          weight: 0.50, 
          value: 0,
          description: 'Saturación de recursos físicos.',
          children: [
            { id: 'cpu', label: 'CPU Pressure', weight: 0.4, value: manager.logNormalize(metrics.executionTime, 5000), description: '...' },
            { id: 'mem', label: 'Memory Pressure', weight: 0.3, value: metrics.hasDiskSort ? 1 : manager.logNormalize(metrics.batches, 128), isCritical: metrics.hasDiskSort, description: '...' },
            { id: 'io', label: 'I/O Pressure',
              weight: 0.3, 
              value: manager.logNormalize(metrics.totalBuffersRead + (metrics.heapFetches * 5), 100000),
              description: 'Volumen de datos leídos y saltos al Heap (Visibilidad/Index no cubierto).' }
          ]
        },
        {
          id: 'scalability',
          label: 'Scalability Risk',
          weight: 0.35, 
          value: 0,
          description: 'Riesgo de degradación futura.',
          children: [
            {
              id: 'recursive_expansion',
              label: 'Recursive Expansion',
              weight: 0.3, 
              value: metrics.recursiveDepth > 0 ? Math.min(
                (manager.logNormalize(metrics.rowsPerIteration, 10000) * (metrics.seqScanInLoop ? 1.5 : 0.5)) +
                (metrics.recursiveDepth * 0.1), 1.0
              ) : 0,
              isCritical: metrics.recursiveDepth > 10,
              description: 'Crecimiento en CTEs recursivas.'
            },
            { 
              id: 'complexity', 
              label: 'Structural Complexity', 
              weight: 0.2,
              isCritical: metrics.isCartesian, 
              value: Math.max(metrics.isCartesian ? 1 : 0, manager.logNormalize(metrics.maxLoops, 100000)),
              description: 'Complejidad algorítmica.'
            },
            { 
              id: 'waste', 
              label: 'Data Waste', 
              weight: 0.2, 
              value: (metrics.executionTime < 100 && !structuralFlags.hasNestedLoop)
            ? metrics.wasteRatio * 0.1  // Castigo leve para queries rápidas
            : (structuralFlags.hasNestedLoop || structuralFlags.hasJoin 
                ? metrics.wasteRatio    // Castigo total para queries complejas
                : metrics.wasteRatio * 0.2),
              description: 'Eficiencia de filtrado.'
            },
            {
              id: 'parallel',
              label: 'Resource Contention',
              weight: 0.3,
              value: structuralFlags.hasWorkerStarvation ? 1.0 : 0, // Impacto total si fallan los workers
              isCritical: structuralFlags.hasWorkerStarvation,
              description: 'Fallo en la asignación de workers paralelos.'
            }
          ]
        },
        {
          id: 'eco',
          label: 'Eco Impact',
          weight: 0.15,
          value: 0,
          description: 'Huella de carbono.',
          children: [
             // TU NODO CARBON ESTÁ BIEN
             { id: 'carbon', label: 'Carbon Footprint', weight: 1.0, value: Math.min(((metrics.totalBuffersRead / 125000) * 0.6) + ((metrics.executionTime / 5000) * 0.4), 1.0) }
          ]
        }
      ]
    };

    manager.resolve(root); 
    return root;
  }

}
