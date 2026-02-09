import { inject, Injectable } from '@angular/core';
import { ImpactNode, ImpactTreeManager, SmartAnalysisResult } from './ImpactTreeManager';
import { ExplainedSuggestion, ExplanationContext, SuggestionGen } from './SuggestionGen'; // ✅ Importamos ExplainedSuggestion

/**
 * Tipos de Nube Soportados
 */
export type CloudProvider = 'AWS' | 'GCP' | 'Azure';

interface CloudPricing {
  computeUnitCostPerMs: number;
  ioCostPerBuffer: number;
}

const ENERGY_COEFFICIENTS = {
  SHARED_HIT: 0.1,
  SHARED_READ: 1.0,
  LOCAL_READ: 0.8,
  TEMP_IO: 1.5,
};

const CLOUD_RATES: Record<CloudProvider, CloudPricing> = {
  AWS: { computeUnitCostPerMs: 0.000012, ioCostPerBuffer: 0.0000005 },
  GCP: { computeUnitCostPerMs: 0.00001, ioCostPerBuffer: 0.0000004 },
  Azure: { computeUnitCostPerMs: 0.000011, ioCostPerBuffer: 0.0000006 },
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
  seqScanInLoop: boolean;
  plannedRows: number;
  actualRows: number;
  heapFetches: number;
  hasJsonbParallel: boolean;
  hasParallel: boolean;
  isHeavySort: boolean;
}

export interface StructuralFlags {
  hasNestedLoop?: boolean;
  hasCartesianProduct?: boolean;
  hasSeqScanInLoop?: boolean;
  hasJoin?: boolean;
  hasRecursiveCTE?: boolean;
  hasForcedMaterialization?: boolean;
  hasRowEstimateDrift?: boolean;
  hasLateFiltering?: boolean;
  hasExternalSortOrHash?: boolean;
  hasWorkerStarvation?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class QueryImpactAnalyzer {
  // private treeManager = new ImpactTreeManager(); // No es necesario instanciarlo aquí si usas métodos estáticos o lo creas dentro
  private suggestionGenerator = inject(SuggestionGen);

  /**
   * Director de Orquesta
   */
  public analyzePlan(
    plan: string,
    provider: CloudProvider,
    frequency: number = 1,
  ): SmartAnalysisResult {
    // 1. FASE DE EXTRACCIÓN (Raw Metrics)
    const metrics = this.extractAllMetrics(plan);

    // Cálculo de Drift
    const driftFactor =
      metrics.plannedRows > 0
        ? Math.abs(metrics.actualRows - metrics.plannedRows) / metrics.plannedRows
        : 0;

    const structuralFlag: StructuralFlags = {
      hasNestedLoop: plan.includes('Nested Loop'),
      hasCartesianProduct: metrics.isCartesian,
      hasSeqScanInLoop: metrics.seqScanInLoop,
      hasJoin: plan.toUpperCase().includes('JOIN'),
      hasRecursiveCTE: metrics.recursiveDepth > 0,
      hasForcedMaterialization: plan.includes('Materialize'),
      hasRowEstimateDrift: driftFactor > 10,
      hasLateFiltering: plan.includes('Filter') && !plan.includes('Index Cond'),
      hasExternalSortOrHash: metrics.hasDiskSort,
      hasWorkerStarvation: metrics.workers < 1 && plan.includes('Workers Planned'),
    };

    // 2. FASE ESTRUCTURAL (Impact Tree)
    const impactTree = this.buildEcoSQLTree(metrics, structuralFlag);

    // 3. FASE DE CONTEXTO
    const manager = new ImpactTreeManager();
    const dominantNodes = manager.getTopOffenders(impactTree);
    const relevantNodes = dominantNodes.filter((n) => n.value > 0.6);
    // const impactSaturation = 1 - Math.max(...dominantNodes.map(n => n.value)); // Ojo: Si value es alto (1.0 = malo), saturation debería reflejar estrés
    // Corrección lógica sugerida: Si el valor más alto es 0.9, el sistema está al 90% de saturación de problemas.
    const impactSaturation =
      dominantNodes.length > 0 ? Math.max(...dominantNodes.map((n) => n.value)) : 0;

    const context: ExplanationContext = {
      impactTree,
      dominantNodes: relevantNodes,
      rawMetrics: metrics,
      plan: plan,
      impactSaturation,
    };

    // 4. GENERACIÓN DE SUGERENCIAS (FIXED)
    // Ya recibimos las sugerencias explicadas y enriquecidas
    const explainedSuggestions: ExplainedSuggestion[] =
      this.suggestionGenerator.generateSmartSuggestions(context, plan);

    // 5. ENSAMBLE FINAL
    return {
      executionTimeMs: metrics.executionTime,
      economicImpact: this.calculateEconomicImpact(metrics, frequency, provider),
      efficiencyScore: (1 - impactTree.value) * 100,
      suggestions: {
        // Mapeamos a arrays de strings simples para compatibilidad con la interfaz SmartAnalysisResult
        list: explainedSuggestions.map((s) => s.title),
        solucion: explainedSuggestions.map(
          (s) => `${s.recommendation} (${s.severity.toUpperCase()})`,
        ),
      },
      provider: provider,
      execTimeInExplain: metrics.execTimeInExplain,
      impactTree,
      topOffenders: context.dominantNodes,
      breakdown: `Análisis completado. Eficiencia del ${((1 - impactTree.value) * 100).toFixed(2)}%.`,
    };
  }

  // ... (RESTO DE LOS MÉTODOS SIN CAMBIOS: calculateEconomicImpact, extractAllMetrics, etc.) ...

  calculateEconomicImpact(
    metrics: RawMetrics,
    frequency: number = 1,
    provider: CloudProvider = 'AWS',
  ): number {
    const rate = CLOUD_RATES[provider];
    const computeCost = metrics.executionTime * rate.computeUnitCostPerMs;
    const weightedIO =
      metrics.totalBuffersRead * ENERGY_COEFFICIENTS.SHARED_READ +
      metrics.tempFilesMb * 128 * ENERGY_COEFFICIENTS.TEMP_IO;
    const ioCostPerExec = weightedIO * rate.ioCostPerBuffer;
    const structuralRiskFee = metrics.isCartesian || metrics.seqScanInLoop ? 1.2 : 1.0;
    const totalCostPerExec = (computeCost + ioCostPerExec) * structuralRiskFee;

    return totalCostPerExec * frequency;
  }

  extractAllMetrics(plan: string): RawMetrics {
    const planUpper = plan.toUpperCase();

    let actualRows = 0;
    let execTimeInExplain = false;

    // Uso de try-catch para manejar excepciones
    try {
      const actualRowsMatches = plan.match(/\(actual\s+time=[\d.]+\.\.[\d.]+\s+rows=(\d+)/gi);
      actualRows = (() => {
        try {
          if (actualRowsMatches && actualRowsMatches.length > 0) {
            const lastMatch = actualRowsMatches[actualRowsMatches.length - 1];
            const value = parseInt(lastMatch.match(/(\d+)$/)?.[1] || '0', 10);
            if (!isNaN(value) && value > 0) return value;
          }
          const pattern2 = /rows=(\d+)/i;
          const match2 = plan.match(pattern2);
          if (match2 && match2[1]) {
            const value = parseInt(match2[1], 10);
            if (!isNaN(value)) return value;
          }
          return 0; // Si no coinciden, devolvemos 0
        } catch (error) {
          console.warn('Error parsing actualRows:', error);
          return 0; // Fallback final si hay error en el parsing
        }
      })();
    } catch (error) {
      console.warn('Error processing actual rows:', error);
    }

    let maxLoops = 1;
    try {
      const loopsMatch = plan.match(/loops=(\d+)/g);
      if (loopsMatch) {
        maxLoops = Math.max(...loopsMatch.map((m) => parseInt(m.split('=')[1], 10))) || 1;
      }
    } catch (error) {
      console.warn('Error processing loops:', error);
    }

    let rowsRemoved = 0;
    try {
      rowsRemoved = parseInt(plan.match(/Rows Removed by Filter: (\d+)/i)?.[1] || '0');
    } catch (error) {
      console.warn('Error parsing rows removed:', error);
    }
    const totalRowsRead = rowsRemoved + actualRows;

    let execTime = 0;
    try {
      const execInfo = this.getExecutionTimeAndExplain(plan);
      execTime = execInfo.execTime;
      execTimeInExplain = execInfo.execTimeInExplain;
    } catch (error) {
      console.warn('Error getting execution time:', error);
    }

    let plannedRows = 0;
    try {
      const plannedRowsMatch = plan.match(/\brows=(\d+)/);
      plannedRows = plannedRowsMatch ? parseInt(plannedRowsMatch[1]) : 0;
    } catch (error) {
      console.warn('Error parsing planned rows:', error);
    }

    let batches = 1;
    let hasDiskSort = false;
    try {
      batches = parseInt(plan.match(/Batches: (\d+)/i)?.[1] || '1');
      hasDiskSort = batches > 1 || /Disk:\s*\d+/.test(plan) || plan.includes('External sort');
    } catch (error) {
      console.warn('Error parsing batches or disk sort:', error);
    }

    let jitTime = 0;
    try {
      const jitMatch = plan.match(/JIT:[\s\S]*?Timing:[\s\S]*?Total ([\d.]+) ms/);
      jitTime = jitMatch ? parseFloat(jitMatch[1]) : 0;
    } catch (error) {
      console.warn('Error parsing JIT time:', error);
    }

    // Similarmente se puede agregar manejo de errores para las demás métricas...
    // Código correspondiente para las demás métricas siguiendo el mismo patrón

    return {
      executionTime: execTime,
      execTimeInExplain: execTimeInExplain,
      planningTime: parseFloat(plan.match(/Planning time: ([\d.]+) ms/i)?.[1] || '0'),
      jitTime,
      hasJsonbParallel:
        plan.includes('Parallel Seq Scan') && (plan.includes('->>') || plan.includes('->')),
      batches,
      hasDiskSort,
      tempFilesMb: 0, // Agrega aquí tu lógica del manejo de errores
      totalBuffersRead: 0, // Agrega aquí tu lógica del manejo de errores
      wasteRatio:
        totalRowsRead > 0
          ? (rowsRemoved / totalRowsRead) * Math.min(1, Math.log10(totalRowsRead) / 5)
          : 0,
      isCartesian:
        planUpper.includes('JOIN FILTER') || (planUpper.includes('NESTED LOOP') && maxLoops > 100),
      workers: parseInt(plan.match(/Workers Launched: (\d+)/i)?.[1] || '0'),
      recursiveDepth: planUpper.includes('RECURSIVE UNION') ? 10 : 0,
      maxLoops,
      rowsPerIteration: actualRows / maxLoops,
      seqScanInLoop: planUpper.includes('SEQ SCAN') && planUpper.includes('RECURSIVE UNION'),
      actualRows,
      plannedRows,
      heapFetches: parseInt(plan.match(/Heap Fetches: (\d+)/)?.[1] || '0'),
      hasParallel: plan.includes('Parallel'),
      isHeavySort: plan.includes('Sort Method') && totalRowsRead > 10000, // Simplificado
    };
  }

  private getExecutionTimeAndExplain(plan: string): {
    execTime: number;
    execTimeInExplain: boolean;
  } {
    let execTime = this.parseFloatFromRegex(plan, /Execution [Tt]ime: ([\d.]+)/) || 0;

    if (execTime === 0) {
      const rootActualTimeMatch = plan.match(/actual time=[\d.]+\.\.([\d.]+)/);
      if (rootActualTimeMatch) {
        execTime = parseFloat(rootActualTimeMatch[1]);
      }
    }
    if (execTime === 0) {
      const costMatch = plan.match(/cost=[\d.]+\.\.([\d.]+)/);
      if (costMatch) {
        execTime = parseFloat(costMatch[1]) / 100;
      }
    }

    const execTimeInExplain = execTime > 0;
    execTime = execTimeInExplain ? execTime : 0.01;

    return { execTime: execTime, execTimeInExplain: execTimeInExplain };
  }

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
          weight: 0.5,
          value: 0,
          description: 'Saturación de recursos físicos.',
          children: [
            {
              id: 'cpu',
              label: 'CPU Pressure',
              weight: 0.4,
              value: manager.logNormalize(metrics.executionTime, 5000),
              description: '...',
            },
            {
              id: 'mem',
              label: 'Memory Pressure',
              weight: 0.3,
              value: metrics.hasDiskSort ? 1 : manager.logNormalize(metrics.batches, 128),
              isCritical: metrics.hasDiskSort,
              description: '...',
            },
            {
              id: 'io',
              label: 'I/O Pressure',
              weight: 0.3,
              value: manager.logNormalize(
                metrics.totalBuffersRead + metrics.heapFetches * 5,
                100000,
              ),
              description:
                'Volumen de datos leídos y saltos al Heap (Visibilidad/Index no cubierto).',
            },
          ],
        },
        {
          id: 'scalability',
          label: 'Scalability Risk',
          weight: 0.25,
          value: 0,
          isCritical: metrics.isHeavySort,
          description: 'Complejidad algorítmica y densidad de ordenamiento.',
          children: [
            {
              id: 'recursive_expansion',
              label: 'Recursive Expansion',
              weight: 0.3,
              value:
                metrics.recursiveDepth > 0
                  ? Math.min(
                      manager.logNormalize(metrics.rowsPerIteration, 10000) *
                        (metrics.seqScanInLoop ? 1.5 : 0.5) +
                        metrics.recursiveDepth * 0.1,
                      1.0,
                    )
                  : 0,
              isCritical: metrics.recursiveDepth > 10,
              description: 'Crecimiento en CTEs recursivas.',
            },
            {
              id: 'complexity',
              label: 'Structural Complexity',
              weight: 0.25,
              isCritical: metrics.isCartesian,
              value: Math.max(
                metrics.isHeavySort ? 0.7 : 0,
                manager.logNormalize(metrics.maxLoops, 10000),
                metrics.jitTime > 0 && metrics.jitTime > metrics.executionTime * 0.15 ? 0.85 : 0,
              ),
              description: 'Complejidad algorítmica.',
            },
            {
              id: 'waste',
              label: 'Data Waste',
              weight: 0.2,
              value:
                metrics.executionTime < 100 && !structuralFlags.hasNestedLoop
                  ? metrics.wasteRatio * 0.1
                  : structuralFlags.hasNestedLoop || structuralFlags.hasJoin
                    ? metrics.wasteRatio
                    : structuralFlags.hasWorkerStarvation
                      ? 1.0
                      : metrics.wasteRatio * (metrics.hasParallel ? 1.5 : 1.0),
              description: 'Eficiencia de filtrado.',
            },
            {
              id: 'parallel',
              label: 'Resource Contention',
              weight: 0.25,
              value: structuralFlags.hasWorkerStarvation ? 1.0 : metrics.hasJsonbParallel ? 0.9 : 0,
              isCritical: structuralFlags.hasWorkerStarvation,
              description: 'Fallo en la asignación de workers paralelos.',
            },
          ],
        },
        {
          id: 'eco',
          label: 'Eco Impact',
          weight: 0.15,
          value: 0,
          description: 'Huella de carbono.',
          children: [
            {
              id: 'carbon',
              label: 'Carbon Footprint',
              weight: 1.0,
              value: Math.min(
                (metrics.totalBuffersRead / 125000) * 0.6 + (metrics.executionTime / 5000) * 0.4,
                1.0,
              ),
            },
          ],
        },
      ],
    };

    manager.resolve(root);
    return root;
  }
}
