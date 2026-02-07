// Script generado por Google Gemini v3 free

import { Injectable } from "@angular/core";
import { text } from "stream/consumers";
import { ImpactNode, ImpactTreeManager, SmartAnalysisResult } from "./ImpactTreeManager";

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

interface RawMetrics {
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
  structuralComplexityBonus: number;
}

interface SuggestionTemplate {
  id: string;
  text: string;
  solution: string;
  triggerNodes: string[]; // IDs de nodos que activan esta sugerencia
  minImpact: number;      // Umbral (0-1) para activarse
  severity: 'low' | 'medium' | 'high' | 'critical';
}

const SUGGESTION_LIBRARY: SuggestionTemplate[] = [
  {
    id: 'NESTED_LOOP_BOMB',
    text: "Detección de bucle anidado ineficiente (Nested Loop).",
    solution: "Faltan condiciones de igualdad en el JOIN o índices en las llaves foráneas. El motor está haciendo un producto cartesiano.",
    triggerNodes: ['complexity', 'waste'],
    minImpact: 0.8,
    severity: 'critical'
  },
  {
    id: 'WORK_MEM_LIMIT',
    text: "El motor está usando el disco para ordenar o cruzar datos.",
    solution: "Incrementar 'work_mem'. Valor sugerido: {val}.",
    triggerNodes: ['mem', 'io'],
    minImpact: 0.6,
    severity: 'critical'
  },
  {
    id: 'WASTE_FILTER',
    text: "Se están descartando demasiadas filas mediante filtros post-lectura.",
    solution: "Crear un índice compuesto que incluya las columnas del WHERE.",
    triggerNodes: ['waste'],
    minImpact: 0.5,
    severity: 'high'
  },
  {
    id: 'CARTESIAN_RISK',
    text: "Detección de Producto Cartesiano o Join ineficiente.",
    solution: "Revisar las condiciones del JOIN; faltan llaves foráneas en el filtro.",
    triggerNodes: ['complexity'],
    minImpact: 0.9,
    severity: 'critical'
  },
  {
    id: 'LOOP_EXPLOSION',
    text: "Detección de bucles excesivos (Loops > 100k).",
    solution: "El optimizador eligió un Nested Loop ineficiente. Considera forzar un Hash Join o añadir índices para convertir los Scans en Index Seeks.",
    triggerNodes: ['complexity'],
    minImpact: 0.8,
    severity: 'critical'
  },
  {
    id: 'RECURSIVE_EXPLOSION',
    text: "Recursión profunda detectada (Recursive Union).",
    solution: "La CTE recursiva está realizando escaneos secuenciales en cada iteración. Asegúrate de tener un índice en la columna de unión (parent_id) para evitar el colapso del rendimiento.",
    triggerNodes: ['complexity', 'io'], // La recursión suele disparar ambos
    minImpact: 0.6,
    severity: 'critical'
  }
];

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

  private treeManager = new ImpactTreeManager();

  public analyze(plan: string, provider: CloudProvider = 'AWS', frequency: number = 1000): SmartAnalysisResult {
    // 1. Extraer métricas crudas (Raw Metrics)
    const metrics = this.extractAllMetrics(plan);
    
    // 2. Construir el Árbol de Impacto
    const impactTree = this.buildTree(metrics);
    
    // 3. Calcular Score y Costos
    const totalImpact = this.treeManager.resolve(impactTree);
    const efficiencyScore = Math.max(0, 100 - (totalImpact * 100));
    
    const executionTimeMs = metrics.executionTime;
    const rate = CLOUD_RATES[provider];
    const baseCost = (executionTimeMs * rate.computeUnitCostPerMs) * (1 + metrics.workers);
    const economicImpact = baseCost * frequency;

    // 4. Generar Sugerencias Basadas en el Árbol
    const topOffenders = this.treeManager.getTopOffenders(impactTree);
    const suggestions = this.generateSmartSuggestions(topOffenders, metrics);

    return {
      executionTimeMs,
      economicImpact,
      efficiencyScore,
      provider,
      impactTree,
      topOffenders,
      suggestions,
      execTimeInExplain: metrics.execTimeInExplain,
      breakdown: this.generateBreakdown(impactTree)
    };
  }

  private hasRecursiveUnion(plan: string): boolean {
    const isRecursive = plan.includes('Recursive Union');
    const hasSeqScanInRecursion = /Recursive Union[\s\S]*?Seq Scan/.test(plan);

    return isRecursive && hasSeqScanInRecursion;
  }

  private extractAllMetrics(plan: string): RawMetrics {
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

    const planTime = this.parseFloatFromRegex(plan, /Planning [Tt]ime: ([\d.]+)/) || 0;
    
    // 2. JIT (Just In Time Compilation) - Impacto en CPU
    const jitTime = this.parseFloatFromRegex(plan, /JIT:[\s\S]*?Total: ([\d.]+)/) || 0;

    // 3. Memoria (Batches y Sorts)
    const hashData = this.extractHashMetrics(plan);
    const hasDiskSort = plan.includes('Sort Method: external merge');
    const tempFilesMatch = plan.match(/Disk: (\d+)kB/);
    const tempFilesMb = tempFilesMatch ? parseInt(tempFilesMatch[1]) / 1024 : 0;

    // 4. I/O (Buffers)
    const sharedRead = this.parseFloatFromRegex(plan, /shared read=(\d+)/) || 0;
    const localRead = this.parseFloatFromRegex(plan, /local read=(\d+)/) || 0;

    // 5. Escalabilidad (Waste Ratio)
    // Buscamos "Rows Removed by Filter" vs "rows="

    const rowsRemovedFilter = this.sumAllMatches(plan, /Rows Removed by Filter: (\d+)/);
    const rowsRemovedJoin = this.sumAllMatches(plan, /Rows Removed by Join Filter: (\d+)/);
    const totalWaste = rowsRemovedFilter + rowsRemovedJoin;

    const rowsReturned = this.parseFloatFromRegex(plan, /actual time=[\d.]+..[\d.]+ rows=(\d+)/) || 1;
    const wasteRatio = totalWaste / (totalWaste + rowsReturned || 1);

    const maxLoops = Math.max(...[...plan.matchAll(/loops=(\d+)/g)].map(m => parseInt(m[1])));

    // 6. Paralelismo y Complejidad
    const workersPlanned = this.parseFloatFromRegex(plan, /Workers Planned: (\d+)/) || 0;
    const isCartesian = plan.includes('Join Filter:') && plan.includes('loops=');

    // Recursive Union
    const hasRecursive = this.hasRecursiveUnion(plan);
    let structuralComplexityBonus = 0;
    if (hasRecursive) structuralComplexityBonus = 0.8

    return {
      executionTime: execTime,
      execTimeInExplain: execTimeInExplain,
      planningTime: planTime,
      jitTime,
      batches: hashData?.batches || 1,
      hasDiskSort,
      tempFilesMb,
      totalBuffersRead: sharedRead + localRead,
      wasteRatio: wasteRatio,
      isCartesian,
      workers: workersPlanned,
      recursiveDepth: (plan.match(/Recursive Union/g) || []).length,
      maxLoops: maxLoops,
      structuralComplexityBonus: structuralComplexityBonus
    };
  }

  /** * Helpers de extracción 
   */
  private parseFloatFromRegex(text: string, regex: RegExp): number {
    const match = text.match(regex);
    return match ? parseFloat(match[1]) : 0;
  }

  private sumAllMatches(text: string, regex: RegExp): number {
    const matches = [...text.matchAll(new RegExp(regex, 'g'))];
    return matches.reduce((acc, m) => acc + parseInt(m[1]), 0);
  }

  private generateSmartSuggestions(topOffenders: ImpactNode[], metrics: RawMetrics): 
    {list: string[], solucion: string[]} {
    const list: string[] = [];
    const solucion: string[] = [];

    // 1. Iterar sobre nuestra base de conocimientos
    for (const template of SUGGESTION_LIBRARY) {
      // 2. Buscar si alguno de los topOffenders coincide con los triggers de esta sugerencia
      const activeTrigger = topOffenders.find(offender => 
        template.triggerNodes.includes(offender.id) && offender.value >= template.minImpact
      );

      if (activeTrigger) {
        // 3. Calcular la importancia relativa para la narrativa
        const impactPercentage = Math.round(activeTrigger.value * 100);
        
        // 4. Personalizar el texto de solución si es necesario (ej: memoria)
        let customSolution = template.solution;
        if (template.id === 'WORK_MEM_LIMIT') {
          customSolution = customSolution.replace('{val}', this.calculateNeededWorkMem(metrics.batches, 4096)); // 4MB default
        }

        // 5. Construir el mensaje con trazabilidad
        list.push(`[${template.severity.toUpperCase()}] ${template.text} (Basado en ${impactPercentage}% de impacto en ${activeTrigger.label})`);
        solucion.push(customSolution);
      }
    }

    return { list, solucion };
  }

  // Esquema conceptual de la construcción
  private buildTree(metrics: any): ImpactNode {
    const manager = new ImpactTreeManager();

    const root: ImpactNode = {
      id: 'query_impact',
      label: 'Query Impact Total',
      weight: 1,
      value: 0,
      children: [
        {
          id: 'perf',
          label: 'Performance Impact',
          weight: 0.5,
          value: 0,
          children: [
            { 
              id: 'cpu', 
              label: 'CPU Pressure', 
              weight: 0.4, 
              value: manager.logNormalize(metrics.executionTime, 5000) 
            },
            { 
              id: 'mem', 
              label: 'Memory Pressure', 
              weight: 0.3, 
              value: metrics.hasDiskSort ? 1 : manager.logNormalize(metrics.batches, 64) 
            },
            { 
              id: 'io', 
              label: 'I/O Pressure', 
              weight: 0.3, 
              value: manager.logNormalize(metrics.tempFilesMb, 100) 
            }
          ]
        },
        {
          id: 'scalability',
          label: 'Scalability Risk',
          weight: 0.4,
          value: 0,
          children: [
            { 
              id: 'waste', 
              label: 'Data Waste', 
              weight: 0.7, 
              value: metrics.wasteRatio > 0.5 ? manager.logNormalize(metrics.wasteRatio * 100, 100) : metrics.wasteRatio 
            },
            { 
              id: 'complexity', 
              label: 'Structural Complexity', 
              weight: 0.4, 
              // Si hay Join Filter o loops > 1000, es riesgo estructural
              value: Math.max(
                metrics.isCartesian ? 1 : 0,
                metrics.structuralComplexityBonus || 0, 
                manager.logNormalize(metrics.maxLoops, 100000) // 100k loops es el umbral de pánico (1.0)
              )
            },
            { 
              id: 'parallel', 
              label: 'Worker Dependency', 
              weight: 0.4, 
              value: metrics.workers > 2 ? 0.8 : 0 
            }
          ]
        },
        {
          id: 'eco',
          label: 'Eco Impact',
          weight: 0.2,
          value: 0,
          // El valor de Eco se deriva de la intensidad de CPU e I/O
          children: [
            { id: 'carbon', label: 'Carbon Footprint', weight: 1, value: 0 } 
          ]
        }
      ]
    };

    manager.resolve(root); // Calcula todos los niveles
    return root;
  }

  private generateBreakdown(root: ImpactNode): string {
    // Obtenemos los 3 grandes pilares
    const perf = root.children?.find(c => c.id === 'perf');
    const scal = root.children?.find(c => c.id === 'scalability');
    const eco = root.children?.find(c => c.id === 'eco');

    const main = [perf, scal, eco].sort((a, b) => (b?.value || 0) - (a?.value || 0))[0];

    if (!main || main.value < 0.2) return "La consulta está bien optimizada.";

    return `Análisis de Causa Raíz: El ${(main.value * 100).toFixed(0)}% del impacto total se concentra en ${main.label}.`;
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
    const filterMatches = Array.from(text.matchAll(/Rows Removed by (?:Join )?Filter: (\d+)/g));
    return filterMatches.reduce((acc, m) => acc + parseInt(m[1]), 0);
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

    const loops = this.loopsSubPlan(texto)

    if (loops > 10000) {
      // Un subplan con muchos loops es una pesadilla de CPU
      score -= 20; 
    }

    if (texto.includes('Recursive Union') && texto.includes('Seq Scan')) {
      score -= 15; // Penalización adicional por escaneo secuencial repetitivo
    }

    if (texto.includes('external merge')) {
      // Restamos 30 puntos base por el impacto energético del I/O.
      score -= 30;
    }

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

    const tableMatch = text.match(/Seq Scan on (\w+)/);
    const tableName = tableMatch ? tableMatch[1] : 'tabla';

    const isCartesian = text.includes('Nested Loop') && text.includes('Join Filter') && removed > 1000000;
    const joinFilter = text.match(/Join Filter: \((.+)\)/)?.[1] || "";
    const isEquality = joinFilter.includes('=');
    const hasInequality = joinFilter.includes('>') || joinFilter.includes('<');
    const filterCols = this.extractFilterColumns(text);
    
    if (isCartesian) {
      list.push(`ERROR DE DISEÑO: Estás generando un Producto Cartesiano.`);
      if (removed > 0 && returned > 0) {
        const wastePercent = ((removed / (removed + returned)) * 100).toFixed(2);
        if (parseFloat(wastePercent) > 90) {
          const filas = this.extractRowsRemoved(text);
          list.push(`Eficiencia Crítica: El ${wastePercent}% de los datos leídos fueron descartados.`);
          solucion.push(`Solución: Crea un índice en la columna utilizada en el filtro para evitar el escaneo de ${filas}+ filas.`);
        }
        if (hasInequality) {
          solucion.push(`Sugerencia: Revisa la lógica del JOIN. Estás usando una desigualdad (> o <) que obliga al motor a comparar todas las filas. ¿Puedes transformarlo en una igualdad (=)?`);
        } else if (joinFilter.includes('=')) {
          solucion.push(`Sugerencia: Aunque usas una igualdad (=), el motor eligió un Nested Loop ineficiente. Esto indica que falta un índice en la columna de unión o que las estadísticas están desactualizadas.`);
        } else {
          solucion.push(`Sugerencia: Revisa la lógica del JOIN. Estás usando una desigualdad o función que impide un Hash Join rápido.`);
        }
      }
    } else if (text.includes('->>')) {
        solucion.push(`✔Solución JSONB: No uses un índice normal. Crea un **Índice de Expresión**:`);
        solucion.push(`✔SQL: CREATE INDEX idx_${tableName}_json ON ${tableName} (${filterCols});`);
    } else {
      
      if (filterCols.length > 0) {
        const col = filterCols[0];
        solucion.push(`Solución: Ejecuta 'CREATE INDEX idx_${tableName}_${col.replace('.', '_')} ON ${tableName} (${col});'. Esto reducirá el impacto de I/O.`);
      }
    }

    if (text.includes('SubPlan')) {
      const loopsMatch = text.match(/SubPlan.*loops=(\d+)/s) || text.match(/loops=(\d+)/g);
      // Nota: Al ser subplan, el loops suele estar en la línea de abajo
      const loops = parseInt(text.match(/SubPlan.*\n.*loops=(\d+)/)?.[1] || "0");

      if (loops > 1000) {
        list.push(`Alerta de SubPlan: Se detectó una subconsulta correlacionada ejecutándose ${loops.toLocaleString()} veces.`);
        list.push(`Tip de Arquitectura: Intenta transformar el SubPlan en un 'LEFT JOIN'. Esto permitirá al motor procesar todo de una sola vez, reduciendo drásticamente el uso de CPU.`);
      }
    }

    if (text.includes("SubPlan")) {
      const loops = this.loopsSubPlan(text)

      // B. Identificación del "Vampiro de CPU"
      const subPlanTimeMatch = text.match(/SubPlan.*\n.*actual time=[\d.]+\.\.([\d.]+)/);
      if (subPlanTimeMatch && loops > 1) {
        const unitTime = parseFloat(subPlanTimeMatch[1]);
        const totalSubPlanTime = unitTime * loops;
        
        if (totalSubPlanTime > (time * 0.5)) {
          list.push(`Vampiro de CPU: El SubPlan consume el ${((totalSubPlanTime/time)*100).toFixed(0)}% del tiempo total.`);
        }
      }

      // Sugerencia de Refactorización
      if (loops > 500) {
        solucion.push(`Sugerencia de Arquitectura: Tienes una subconsulta ejecutándose ${loops.toLocaleString()} veces. Reescribe esto como un JOIN para pasar de O(n) a O(log n) o O(1).`);
      }
    }

    const widthMatch = text.match(/width=(\d+)/);
    if (widthMatch) {
      const width = parseInt(widthMatch[1]);
      // Si el ancho es mayor a 100 bytes, es muy probable que haya columnas innecesarias
      if (width > 100 && returned > 1000) {
        list.push(`Fila muy ancha (${width} bytes): Considera seleccionar solo las columnas necesarias. Reducir el ancho de fila ahorra energía en el bus de datos.`);
      }
    }
    
    if (text.includes('Seq Scan') && removed > returned) {
      list.push("Seq Scan detectado: Se están descartando más filas de las que se devuelven. Falta un índice.");
    }

    if (text.includes('Disk:')) {
      list.push("Memoria Crítica: Se usó el disco para ordenar. Sube el 'work_mem'.");
    }

    const hashMetrics: {batches: number, buckets: number, memoryUsedKb: number}| null = this.extractHashMetrics(text);
    // Detección de Memoria mejorada 
    const batchMatch = text.match(/Batches: (\d+)/);
    if (hashMetrics && batchMatch && parseInt(batchMatch[1]) > 1) {
      const recommendedMem = this.calculateNeededWorkMem(hashMetrics.batches, hashMetrics.memoryUsedKb);
      // Cálculo de exceso: batches es el multiplicador de insuficiencia
      const excessPercent = (hashMetrics.batches - 1) * 100;
      const currentLimit = `${hashMetrics.memoryUsedKb}kB`;
      
      list.push(`Optimización de Memoria: El Hash Join se desbordó a ${hashMetrics.batches} batches.`);
    
      list.push(`Límite Superado: Los datos exceden en un ${excessPercent}% la capacidad de 'work_mem' actual (${currentLimit}). El límite ideal para esta consulta es de 1 batch.`);
      
      solucion.push(`Acción: Incrementa 'work_mem' a al menos ${recommendedMem} para que toda la operación ocurra en RAM.`);
    }

    // Detección de Sorting en Disco
    const sortDiskMatch = text.match(/Disk:\s+(\d+)(kB|MB)/);

    if (sortDiskMatch) {
      const diskKb = parseInt(sortDiskMatch[1]);

      list.push(`Alerta de I/O de Disco: El ordenamiento excedió la RAM y escribió  ${(diskKb/1024).toFixed(1)}MB  en disco.`);

      // Sugerimos el tamaño del disco + 25% de margen, convertido a MB para que sea legible
      const suggestedMemMb = Math.ceil((diskKb * 1.25) / 1024); 
  
      solucion.push(`✔Solución: Incrementa 'work_mem' a  ${suggestedMemMb}MB  para que el Sort ocurra enteramente en memoria.`);
      solucion.push(`Tip Pro: Si consultas 'created_at DESC' frecuentemente, un índice en esa columna eliminaría la necesidad de ordenar.`);
    }

    const hasFilter = text.includes('Filter:');
    const hasSort = text.includes('Sort Key:');

    const sortCol = text.match(/Sort Key: ([\w_]+)/)?.[1] || "la columna de ordenamiento";
    if (hasSort && !text.includes('Index Scan')) {
      // Si hay un Sort y no se está usando ya un índice para ordenar
      const table = this.extractTableName(text);
      solucion.push(`✔Solución de Ordenamiento: Crea un índice en  ${tableName}(${sortCol})  para eliminar el paso de 'Sort' por completo.`);
    
    } else if (hasFilter && removed > 1000) {
      // Solo si NO hay un problema de Sort dominante, sugerimos el del filtro
      solucion.push(`✔Solución de Filtro: Crea un índice en  ${tableName}(${sortCol}) .`);
    }
    if (hasFilter && removed > returned) {
      const filterMatch = text.match(/Filter: \(([\w_]+)\s*[!=<>]+/);
      if (filterMatch) {
          const column = filterMatch[1];
          const tableMatch = text.match(/on ([\w_]+)/);
          const table = tableMatch ? tableMatch[1] : "tabla";
          
          list.push(`Solución: Ejecuta 'CREATE INDEX idx_${table}_${column} ON ${table} (${column});'.`);
      }
      const joinMatch = text.match(/Join Filter: \(.*\.([\w_]+)\s*=\s*.*\.([\w_]+)\)/);
      if (joinMatch) {
          list.push(`Solución: Falta un índice de unión. Prueba con: 'CREATE INDEX idx_relacion ON tabla (${joinMatch[1]});'`);
      }
      const sortMatch = text.match(/Sort Key: ([\w_]+)/);
      if (sortMatch) {
          const column = sortMatch[1];
          const table = this.extractTableName(text); // Tu función para sacar el nombre de la tabla
          
          list.push(`Solución: Crea un índice en '${column}' para eliminar el paso de ordenamiento (Sort). El motor podrá leer los datos ya ordenados.`);
          list.push(`SQL: CREATE INDEX idx_${table}_${column}_desc ON ${table} (${column} DESC);`);
      }
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
        list.push(`Desborde en Ordenamiento: Se volcaron ${diskMatch[1]}${diskMatch[2]} a disco porque la 'work_mem' fue insuficiente para el Sort.`);
      }
    }

    if (text.includes('Nested Loop') && text.includes('Join Filter')) {
      const removedByJoin = text.match(/Rows Removed by Join Filter: (\d+)/);
      if (removedByJoin && parseInt(removedByJoin[1]) > 1000000) {
        list.push(`Alerta de Producto Cartesiano: Se detectó una comparación cruzada masiva (${parseInt(removedByJoin[1]).toLocaleString()} filas descartadas).`);
        list.push(`Análisis: El filtro '${text.match(/Join Filter: (.+)/)?.[1]}' está obligando a comparar casi todas las filas entre sí.`);
        solucion.push(`Sugerencia: Revisa la lógica del JOIN. ¿Es realmente necesaria una desigualdad (>)? Si puedes usar una igualdad (=), el motor podrá usar un Hash Join mucho más eficiente.`);
      }
    }

    if (text.includes('Recursive Union')) {
      list.push(`Recursión Detectada: Las consultas recursivas son sensibles al rendimiento. Cada milisegundo extra aquí se multiplica por el número de niveles de la jerarquía.`);
  
      const heavyHierarchyMatch = text.match(/Seq Scan on (\w+).*loops=(\d+)/);
      if (heavyHierarchyMatch && parseInt(heavyHierarchyMatch[2]) > 1) {
        const tableName = heavyHierarchyMatch[1];
        const loops = heavyHierarchyMatch[2];
        list.push(`Multiplicador de Loops: La tabla '${tableName}' se escaneó ${loops} veces. En recursión, esto indica que falta un índice en la columna de unión (parent_id/id).`);
      }
    }

    const loopsMatch = text.match(/loops=(\d+)/);
    if (loopsMatch && parseInt(loopsMatch[1]) > 10000) {
        list.push(`Bucle de Alta Frecuencia: Un nodo se ejecutó ${parseInt(loopsMatch[1]).toLocaleString()} veces. Esto multiplica cualquier pequeña ineficiencia por un millón.`);
    }

    if (text.includes('Recursive Union')) {
      // Buscamos específicamente la condición de unión dentro del join recursivo
      const joinCondMatch = text.match(/Hash Cond: \(([\w.]+)\s*=\s*([\w.]+)\)/);
      if (joinCondMatch) {
        const leftSide = joinCondMatch[1]; // h.parent_id
        const rightSide = joinCondMatch[2]; // r.id
        
        // Si r.id es la WorkTable, el índice debe ir en h.parent_id
        const targetCol = leftSide.includes('h.') ? leftSide.replace('h.', '') : leftSide;
        solucion.push(`Tip de Recursión: Crea un índice en 'heavy_hierarchy(${targetCol})'. Esto transformará el Seq Scan repetitivo en un Index Scan ultra rápido.`);
      }
    }

    const jitTotalMatch = text.match(/JIT:.*Total ([\d.]+) ms/s);
    if (jitTotalMatch) {
      const jitTime = parseFloat(jitTotalMatch[1]);
      if (jitTime > 500) {
        list.push(`JIT Overhead: La compilación tardó ${jitTime.toFixed(0)}ms. Para consultas de telemetría repetitivas, esto es un gasto extra de energía.`);
      }
    }

    if (text.includes('Parallel Seq Scan')) {
      const workers = text.match(/Workers Launched: (\d+)/)?.[1] || 'n/a';
      list.push(`Paralelismo detectado: Se están usando ${workers} workers para compensar un escaneo lento.`);
      
      if (removed > returned * 5) {
        list.push(`Desperdicio Energético: El paralelismo está ocultando la falta de un índice. Usar múltiples CPUs para filtrar basura es altamente ineficiente desde una perspectiva Green-IT.`);
      }
    }


    if (text.includes('Limit') && text.includes('Seq Scan')) {
      list.push(`Trampa de Limit: Aunque pides pocos resultados, el motor escaneó la tabla completa antes de aplicar el límite. El ahorro de energía es nulo.`);
    }

    if (text.includes('Materialize') && text.includes('loops=')) {
      const materializeLoops = text.match(/Materialize.*loops=(\d+)/)?.[1] || "1";
      if (Number(materializeLoops) > 1000) {
        list.push(`Bucle Térmico: El nodo 'Materialize' se repitió ${materializeLoops.toLocaleString()} veces. Cada repetición consume ciclos de CPU y memoria innecesarios.`);
      }
    }

    

    return {list: list, solucion: solucion};
  }

  private loopsSubPlan(text: string) {
    const loopsMatch = text.match(/SubPlan.*loops=(\d+)/s) || text.match(/loops=(\d+)/g);
    return loopsMatch ? parseInt(loopsMatch[1]) : 1;
  }

  private extractFilterColumns(text: string): string {
    // 1. Buscamos el patrón después de "Filter:" o "Index Cond:" o "Join Filter:"
    // Buscamos algo como (columna = ... o (columna > ...
    const filterMatch = text.match(/(?:Filter|Index Cond|Join Filter): \("?([\w_]+)"?[\s]*[!=<>]+/i);

    if (filterMatch) {
      // Retornamos el primer grupo de captura que es el nombre de la columna
      return filterMatch[1];
    }

    // 2. Si no hay un operador claro, buscamos la primera palabra entre paréntesis
    const genericMatch = text.match(/(?:Filter|Join Filter): \(([\w_]+)/i);
    if (genericMatch) return genericMatch[1];

    const jsonMatch = text.match(/Filter: \(\(([\w_]+)\s*->>[\s']*([\w_]+)'\) =/i);
    if (jsonMatch) {
      return `(${jsonMatch[1]}->>'${jsonMatch[2]}')`; // Retorna: (metadata->>'type')
    }

    return "columna";
  }

  private extractTableName(text: string): string {
    // 1. Intentamos buscar el patrón estándar de PostgreSQL: "on nombre_tabla"
    // Captura casos como "Seq Scan on users", "Index Scan on orders_pk", etc.
    const scanMatch = text.match(/(?:Scan on|Update on|Delete on|Insert on)\s+([\w_]+)/i);
    if (scanMatch) return scanMatch[1];

    // 2. Si es un CTE, buscamos el nombre del CTE
    const cteMatch = text.match(/CTE\s+([\w_]+)/i);
    if (cteMatch) return cteMatch[1];

    // 3. Si no encuentra nada, devolvemos un genérico para no romper el string
    return "<<tabla>>";
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
    const bucketsMatch = text.match(/Buckets: (\d+)/);
    const batchesMatch = text.match(/Batches: (\d+)/);
    const memoryMatch = text.match(/Memory Usage: (\d+)(kB|MB)/);

    if (!bucketsMatch && !batchesMatch && !memoryMatch) return null;

    let memKb = 0;
    if (memoryMatch) {
      memKb = parseFloat(memoryMatch[1]);
      if (memoryMatch[2] === 'MB') memKb *= 1024;
    }

    return {
      buckets: bucketsMatch ? parseInt(bucketsMatch[1]) : 0,
      batches: batchesMatch ? parseInt(batchesMatch[1]) : 1, // Default 1 si no hay batches a disco
      memoryUsedKb: memKb
    };
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