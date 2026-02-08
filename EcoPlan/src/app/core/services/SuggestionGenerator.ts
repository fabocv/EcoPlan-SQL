import { Injectable } from '@angular/core';
import { ImpactNode } from './ImpactTreeManager';
import { RawMetrics } from './QueryImpactAnalyzer';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

interface FinalizerContext {
  metrics: RawMetrics;
  dominantNodes: ImpactNode[];
  impactSaturation: number;
}


type SuggestionFinalizer = (
    text: string,
    ctx: FinalizerContext
  ) => string;

export interface EvaluatedSuggestion {
  templateId: string;
  kind: SuggestionKind;
  severity: Severity;

  // Texto base
  text: string;
  solution: string;

  // Contexto de evaluación
  triggeringNode: {
    id: string;
    value: number;
  };

  impactScore: number; // qué tan por encima del minImpact está
}

interface ExplanationContext {
  impactSaturation: number;
  dominantNodes: ImpactNode[];
  rawMetrics: RawMetrics;
  plan: string;
}

export interface ExplainedSuggestion {
  id: string;
  kind: SuggestionKind;
  severity: Severity;

  title: string;

  explanation: string;   // el “por qué”
  evidence: string[];    // datos concretos del plan / métricas
  recommendation: string;

  impactSummary: {
    node: string;
    value: number;
    contribution: number; // % del impacto total
  };
}

const NODE_PRECEDENCE: Record<string, number> = {
  recursive_expansion: 100,
  parallel: 90,
  structural: 80,
  complexity: 85,
  waste: 40,
  mem: 30,
  io: 20
};



type SuggestionKind = 'corrective' | 'opportunistic' | 'preventive' | 'optimization';

export interface SuggestionTemplate {
  id: string;
  text: string;
  solution: string;
  kind: SuggestionKind;
  triggerNodes: string[];
  minImpact: number;
  severity: Severity;
  validate?: (plan: string) => boolean;
}

export const SUGGESTION_LIBRARY: SuggestionTemplate[] = [
  {
    id: 'PARALLEL_CRITICAL',
    text: "Fallo total de paralelismo (Resource Contention).",
    solution: "El optimizador planeó workers pero el sistema no pudo iniciarlos. Revisa 'max_parallel_workers' o la carga de CPU; la consulta se ejecutó de forma secuencial.",
    triggerNodes: ['parallel'], //
    minImpact: 0.5,
    kind: 'corrective',
    severity: 'critical',
    validate: (plan: string) => {
      const p = parseInt(plan.match(/Workers Planned: (\d+)/)?.[1] || "0");
      const l = parseInt(plan.match(/Workers Launched: (\d+)/)?.[1] || "0");
      return p > 0 && l === 0;
    }
  },
  {
    id: 'PARALLEL_DEGRADED',
    text: "Paralelismo degradado.",
    solution: "Se iniciaron menos workers de los planeados. La consulta es más lenta por falta de recursos disponibles en el sistema.",
    triggerNodes: ['parallel'], //
    minImpact: 0.3,
    severity: 'medium', // Es un warning, no detiene el mundo pero avisa
    kind: 'preventive',
    validate: (plan: string) => {
      const p = parseInt(plan.match(/Workers Planned: (\d+)/)?.[1] || "0");
      const l = parseInt(plan.match(/Workers Launched: (\d+)/)?.[1] || "0");
      return p > 0 && l > 0 && l < p;
    }
  },
  {
    id: 'NESTED_LOOP_BOMB',
    text: "Detección de bucle anidado ineficiente (Nested Loop).",
    solution: "Faltan condiciones de igualdad en el JOIN o índices en las llaves foráneas. El motor está haciendo un producto cartesiano.",
    triggerNodes: ['complexity', 'waste'],
    minImpact: 0.8,
    severity: 'critical',
    kind: 'corrective',
    validate: (plan: string) => {
      // Un "Bomb" es cuando hay loops altos (> 10k) combinados con un Seq Scan interno
      const hasHighLoops = /loops=(\d{5,})/.test(plan); 
      const hasInnerSeqScan = plan.includes('Nested Loop') && plan.includes('Seq Scan on');
      return hasHighLoops && hasInnerSeqScan;
    }
  },
  {
    id: 'RECURSIVE_BOMB',
    text: 'Bomba de Tiempo en Recursión.',
    solution: 'La CTE recursiva está realizando un Seq Scan sobre la tabla principal en cada paso. Crea un índice en la columna de unión para detener la degradación lineal.',
    triggerNodes: ['recursive_expansion'],
    minImpact: 0.7,
    severity: 'critical',
    kind: 'corrective',
    validate: (plan: string) => /Recursive Union[\s\S]*?Seq Scan/.test(plan)
  },
  {
    id: 'JSONB_OPTIMIZATION',
    text: "Acceso ineficiente a campos JSONB detectado.",
    solution: "Estás filtrando por una llave JSON (->>). El motor debe parsear cada documento en cada fila. Considera crear un índice funcional o un índice GIN: 'CREATE INDEX idx_name ON table ((col->>\"key\"));'",
    triggerNodes: ['waste', 'complexity'],
    minImpact: 0.7,
    kind: 'opportunistic',
    severity: 'critical',
    validate: (plan: string) => {
        // Buscamos el operador -> o ->> seguido de un filtro
        return (plan.includes('->>') || plan.includes('->')) && plan.includes('Filter:');
    }
  },
  {
    id: 'WORK_MEM_LIMIT',
    text: "El motor está usando el disco para ordenar o cruzar datos.",
    solution: "Incrementar 'work_mem'. Valor sugerido: {val}.",
    triggerNodes: ['mem', 'io'],
    minImpact: 0.6,
    kind: 'corrective',
    severity: 'critical',
    validate: (plan: string) => {
      const batchesMatch = plan.match(/Batches: (\d+)/);
      const batches = batchesMatch ? parseInt(batchesMatch[1]) : 1;
      return batches > 1 || plan.includes('Disk') || plan.includes('External sort');
    }
  },
  {
    id: 'WASTE_FILTER',
    text: "Ineficiencia detectada: Descarte de filas elevado.",
    solution: "Se están leyendo muchas filas que luego se descartan. Revisa el índice.",
    triggerNodes: ['waste'],
    minImpact: 0.4,
    severity: 'low',
    kind: 'opportunistic',
    validate: (plan: string) => {
      const isExplicitFilter = plan.includes('Filter: ') && !plan.includes('Join Filter: ');
      const isLargeWaste = plan.includes('Rows Removed by Filter');
      
      return isExplicitFilter && isLargeWaste;
    },
  },
  {
    id: 'CARTESIAN_RISK',
    text: "Detección de Producto Cartesiano o Join ineficiente.",
    solution: "Revisar las condiciones del JOIN; faltan llaves foráneas en el filtro.",
    triggerNodes: ['complexity'],
    minImpact: 0.9,
    kind: 'corrective',
    severity: 'critical',
    validate: (plan: string) => {
        // En Postgres, un producto cartesiano suele aparecer como Nested Loop 
        // SIN un "Index Cond" o "Join Filter" que use columnas de ambas tablas.
        return plan.includes('Nested Loop') && !plan.includes('Index Cond') && !plan.includes('Join Filter');
    }
  },
  {
    id: 'LOOP_EXPLOSION',
    text: "Detección de bucles excesivos (Loops > 100k).",
    solution: "El optimizador eligió un Nested Loop ineficiente. Considera forzar un Hash Join o añadir índices para convertir los Scans en Index Seeks.",
    triggerNodes: ['complexity'],
    minImpact: 0.8,
    severity: 'critical',
    kind: 'corrective',
    validate: (plan: string) => {
        const loopsMatch = plan.match(/loops=(\d+)/g);
        if (!loopsMatch) return false;
        return loopsMatch.some(m => parseInt(m.split('=')[1]) > 100000);
    }
  },
  {
    id: 'PARTIAL_INDEX',
    text: 'Oportunidad de Índice Parcial detectada.',
    solution: 'Si el filtro es sobre un estado constante (ej. is_active = true), un índice parcial reduciría el tamaño del índice y mejoraría el performance.',
    triggerNodes: ['waste'],
    minImpact: 0.6,
    severity: 'low',
    kind: 'opportunistic',
    validate: (plan: string) => {
        // Buscamos filtros comunes de baja cardinalidad: booleanos, nulos o estados
        const partialPatterns = [
            /=\s*(true|false|NULL)/i,
            /status\s*=\s*'\w+'/i,
            /is_\w+\s*=\s*/i
        ];
        return plan.includes('Filter: ') && partialPatterns.some(regex => regex.test(plan));
    }
  },
  {
    id: 'JOIN_EXPLOSION',
    text: 'Join no selectivo / Explosión combinatoria.',
    solution: 'El JOIN actual genera un producto cartesiano o un bucle ineficiente. Añade condiciones de igualdad o índices en las llaves foráneas.',
    triggerNodes: ['waste', 'complexity'],
    minImpact: 0.8,
    kind: 'corrective',
    severity: 'critical',
    // Solo se activa si hay "Join Filter" o "Nested Loop"
    validate: (plan: string) => plan.includes('Join Filter') || plan.includes('Nested Loop')
  },
  {
    id: 'PARTITION_PRUNING_FAIL',
    text: "Fallo en el podado de particiones (Partition Pruning).",
    solution: "PostgreSQL está escaneando particiones irrelevantes (ej. meses anteriores). Asegúrate de que la columna de partición esté en el WHERE y que no existan funciones que impidan el pruning, como 'date_trunc()'.",
    triggerNodes: ['waste', 'structural'],
    minImpact: 0.8,
    kind: 'preventive',
    severity: 'critical',
    validate: (plan: string) => {
        // Si hay un Append con muchos sub-nodos de escaneo de tablas particionadas
        const partitionCount = (plan.match(/Scan on \w+_\d+/g) || []).length;
        return plan.toLowerCase().includes('partition') || plan.includes('Append') && partitionCount > 3; 
    }
  },
  {
    id: 'HEAP_FETCH_WARNING',
    text: "Alto número de Heap Fetches en Index Scan.",
    solution: "El índice se usa, pero el motor debe ir a la tabla principal para buscar columnas faltantes (ej. 'country') o verificar visibilidad (VACUUM). Considera un Index Only Scan incluyendo las columnas en el índice: CREATE INDEX ... INCLUDE (country).",
    triggerNodes: ['io', 'waste'],
    minImpact: 0.3,
    severity: 'medium', 
    kind: 'corrective', // Corrective para que aparezca en modo crisis
    validate: (plan: string) => {
        const hf = parseInt(plan.match(/Heap Fetches: (\d+)/)?.[1] || "0");
        return hf > 1000;
    }
  },
  {
    id: 'CORRELATED_SUBPLAN',
    text: "Subconsulta correlacionada detectada (Vampiro de CPU).",
    solution: "El motor ejecuta el 'SubPlan' una vez por cada fila de la consulta principal ({val} veces). Convierte la subconsulta en un LEFT JOIN o un LATERAL JOIN para procesar los datos en bloque.",
    triggerNodes: ['complexity', 'performance'],
    minImpact: 0.6,
    severity: 'critical',
    kind: 'corrective',
    validate: (plan: string) => {
      // Busca la existencia de un SubPlan ejecutado en bucle
      return plan.includes('SubPlan') && /loops=(\d{4,})/.test(plan);
    }
  },
  {
    id: 'JIT_OVERHEAD_DETECTION',
    text: "Sobrecarga de JIT detectada.",
    solution: "El JIT tardó {val}ms en compilar. Para esta consulta, el beneficio de JIT es marginal frente al costo de parsing de JSONB. Considera desactivar JIT para esta query o, mejor aún, crear un índice GIN.",
    triggerNodes: ['complexity'],
    minImpact: 0.4,
    severity: 'medium',
    kind: 'preventive',
    validate: (plan: string) => {
      const jitMatch = plan.match(/Total ([\d.]+) ms/);
      const jitTotal = jitMatch ? parseFloat(jitMatch[1]) : 0;
      return jitTotal > 300;
    }
  },
  {
    id: 'JSONB_PARALLEL_SCAN',
    text: "Escaneo paralelo de JSONB (CPU Intensive).",
    solution: "Los 4 workers están consumiendo CPU parseando JSONB. La solución definitiva es un índice funcional: 'CREATE INDEX idx_telemetry_type ON big_telemetry ((metadata->>'type'));'",
    triggerNodes: ['parallel'],
    minImpact: 0.5,
    severity: 'critical',
    kind: 'corrective',
    validate: (plan: string) => plan.includes('->>') && plan.includes('Parallel Seq Scan')
  },
  {
    id: 'HIGH_SELECTIVITY_SCAN',
    text: "Escaneo completo para buscar una aguja en un pajar.",
    solution: "El motor leyó y descartó más del 99% de las filas para encontrar muy pocos resultados. Falta un índice en la columna del filtro: 'CREATE INDEX ... WHERE column = value'.",
    triggerNodes: ['waste', 'io'], // Se dispara por desperdicio o I/O
    minImpact: 0.5,
    severity: 'critical', // CRÍTICO para que aparezca sí o sí
    kind: 'corrective',
    validate: (plan: string) => {
      // Extraemos filas eliminadas y filas devueltas
      const removedMatch = plan.match(/Rows Removed by Filter: (\d+)/);
      const rowsMatch = plan.match(/actual time=[\d.]+..[\d.]+ rows=(\d+)/);
      
      if (!removedMatch || !rowsMatch) return false;
      
      const removed = parseInt(removedMatch[1]);
      const returned = parseInt(rowsMatch[1]);
      
      // Si descartamos más de 10,000 filas y la proporción es 1000:1
      return removed > 10000 && removed > (returned * 1000);
    }
  },
    {
    id: 'MISSING_SORT_INDEX',
    text: "Ordenamiento costoso sin índice (Full Sort).",
    solution: "Estás ordenando {rows} filas manualmente. Crea un índice que coincida con el orden solicitado para eliminar el paso de 'Sort' completamente.\nSugerencia: CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);",
    triggerNodes: ['perf', 'scalability'],
    minImpact: 0.4,
    severity: 'high', // Es High porque ahorra CPU y RAM
    kind: 'optimization', // Es una optimización estructural, no solo correctiva
    validate: (plan: string) => {
      // Detectamos un Sort explícito sobre un Seq Scan
      const hasSort = plan.includes('Sort Key:');
      const hasSeqScan = plan.includes('Seq Scan');
      const rowsMatch = plan.match(/Sort[\s\S]*?rows=(\d+)/);
      const rows = rowsMatch ? parseInt(rowsMatch[1]) : 0;

      // Si ordenamos más de 10,000 filas secuencialmente, falta un índice
      return hasSort && hasSeqScan && rows > 10000;
    }
  },
  {
    id: 'PARALLEL_BRUTE_FORCE',
    text: "Uso ineficiente de paralelismo (Fuerza Bruta).",
    solution: "Estás usando Parallel Seq Scan para filtrar datos. Aunque es rápido, consume CPU excesiva y bloquea núcleos. Un índice simple sería más rápido y barato.",
    triggerNodes: ['waste', 'parallel', 'eco'],
    minImpact: 0.4, 
    severity: 'critical',
    kind: 'corrective',
    validate: (plan: string) => {
      // Detectamos Parallel Scan combinado con alto descarte de filas
      const isParallel = plan.includes('Parallel Seq Scan');
      const hasFilter = plan.includes('Filter:');
      const removedMatch = plan.match(/Rows Removed by Filter: (\d+)/);
      const removed = removedMatch ? parseInt(removedMatch[1]) : 0;
      
      // Si es paralelo y descarta muchas filas, es fuerza bruta
      return isParallel && hasFilter && removed > 10000;
    }
  },
  {
    id: 'ORDER_BY_INDEX_MISSING',
    text: "Ordenamiento masivo detectado (External Sort).",
    solution: "El motor está ordenando {val} filas en disco. Crear un índice en la columna de ordenamiento ('created_at') eliminaría este paso por completo.",
    triggerNodes: ['complexity', 'scalability'],
    minImpact: 0.4,
    severity: 'high',
    kind: 'optimization',
    validate: (plan) => plan.includes('Sort Key:') && plan.includes('external merge')
  }
];


/**
 * CONTEXTO DE SUGERENCIA: Agrupa la semántica del árbol con los hallazgos del plan
 */
export interface SuggestionContext {
  impactTree: ImpactNode;              // Raíz del árbol
  dominantNodes: ImpactNode[];         // Top offenders ya calculados
  structuralFlags: StructuralFlags;    // Flags detectados por Regex
  rawMetrics: RawMetrics;              // Métricas crudas para inyección de valores
  impactSaturation: number;
}

/**
 * FLAGS ESTRUCTURALES: Criticidades técnicas detectadas en el explain
 */
export interface StructuralFlags {
  // Join & loops
  hasNestedLoop?: boolean;
  hasCartesianProduct?: boolean;
  hasSeqScanInLoop?: boolean;
  hasJoin?: boolean;

  // Recursion & materialization
  hasRecursiveCTE?: boolean;
  hasForcedMaterialization?: boolean;

  // Planner quality
  hasRowEstimateDrift?: boolean;
  hasLateFiltering?: boolean;

  // Memory & IO structure
  hasExternalSortOrHash?: boolean;

  // Parallelism
  hasWorkerStarvation?: boolean;
}


@Injectable({
  providedIn: 'root'
})
export class SuggestionGenerator {


  constructor() { }


  public generateSmartSuggestions(
    context: SuggestionContext,
    plan: string
  ): ExplainedSuggestion[] {

    // ─────────────────────────────
    // FASE 1 — MATCH TÉCNICO
    // ¿Qué sugerencias aplican?
    // ─────────────────────────────
    const evaluated = this.evaluateTemplates(context, plan);

    if (evaluated.length === 0) return [];

    // ─────────────────────────────
    // FASE 2 — DECISIÓN SEMÁNTICA
    // (si decides filtrar por kind / saturation)
    // ─────────────────────────────
    const filtered = this.filterByKind(
      evaluated,
      context.impactSaturation
    );

    if (filtered.length === 0) return [];

    // ─────────────────────────────
    // FASE 3 — REDUCCIÓN DE RUIDO
    // ─────────────────────────────
    const collapsed = this.collapseSuggestions(filtered);

    // ─────────────────────────────
    // FASE 4 — EXPLICACIÓN CAUSAL
    // ─────────────────────────────
    const explained = this.buildExplanations(
      collapsed,
      {
        impactSaturation: context.impactSaturation,
        dominantNodes: context.dominantNodes,
        rawMetrics: context.rawMetrics,
        plan
      }
    );

    // ─────────────────────────────
    // FASE 5 — FINALIZACIÓN (texto dinámico)
    // ─────────────────────────────
    return explained.map(s => ({
      ...s,
      recommendation: this.finalizeSuggestion(
        s.id,
        s.recommendation,
        {
          metrics: context.rawMetrics,
          dominantNodes: context.dominantNodes,
          impactSaturation: context.impactSaturation
        }
      )
    }));
  }

  private filterByKind(
    suggestions: EvaluatedSuggestion[],
    impactSaturation: number
  ): EvaluatedSuggestion[] {

    const hasCritical = suggestions.some(s => s.kind === 'corrective' || s.severity === 'critical');
    
    // Devolver todo si no hay nada crítico que priorizar
    if (!hasCritical) {
        return suggestions; 
    }

    // Sistema en crisis → solo corregimos
    if (impactSaturation < 0.3) {
      return suggestions.filter(s => s.kind === 'corrective');
    }

    // Sistema bajo presión → corregimos + prevenimos
    if (impactSaturation < 0.6) {
      return suggestions.filter(
        s => s.kind === 'corrective' || s.kind === 'preventive'
      );
    }

    // Sistema estable → todo vale
    return suggestions;
  }


  
  FINALIZERS: Record<string, SuggestionFinalizer> = {
    WORK_MEM_LIMIT: (text, ctx) => {
      const suggestedVal = this.calculateSuggestedWorkMem(ctx.metrics.tempFilesMb);

      return text.replace(
        '{val}',
        `${suggestedVal}`
      );
    },

    WASTE_FILTER: (text, ctx) => {
      const wasteNode = ctx.dominantNodes.find(n => n.id === 'waste');
      if (!wasteNode) return text;

      const pct = Math.round(wasteNode.value * 100);
      return `${text} (Se descarta ~${pct}% de las filas leídas.)`;
    },

    LOOP_EXPLOSION: (text, ctx) => {
      const loops = ctx.metrics.maxLoops;
      if (!loops) return text;

      return `${text} (Detectados ${loops.toLocaleString()} loops.)`;
    }
  };

  private calculateSuggestedWorkMem(tempFilesMb: number): string {
    if (tempFilesMb <= 0) return "64MB"; // Valor base recomendado

    // Aplicamos el factor 1.5 y redondeamos a la potencia de 2 más cercana para sanidad
    const rawSuggestion = tempFilesMb * 1.5;
    const recommended = Math.max(64, Math.ceil(rawSuggestion / 32) * 32); 

    return `${recommended}MB`;
  }

  private finalizeSuggestion(
    suggestionId: string,
    text: string,
    ctx: FinalizerContext
  ): string {

    const finalizer = this.FINALIZERS[suggestionId];
    if (!finalizer) return text;

    try {
      return finalizer(text, ctx);
    } catch {
      // Regla de oro: nunca romper el pipeline por texto
      return text;
    }
  }

  /**
   * FASE 1: Evalúa qué plantillas de la librería aplican según el plan y el impacto.
   */
  private evaluateTemplates(
    context: SuggestionContext,
    plan: string
  ): EvaluatedSuggestion[] {

    const { dominantNodes } = context;

    return SUGGESTION_LIBRARY.flatMap(template => {

      // 1. Match por impacto
      const matchingNodes = template.triggerNodes
        .map(tId => dominantNodes.find(dn => dn.id === tId))
        .filter((n): n is ImpactNode => !!n && n.value >= template.minImpact);

      if (matchingNodes.length === 0) return [];

      // 2. Validación técnica
      if (template.validate && !template.validate(plan)) {
        return [];
      }

      // 3. Emitimos una sugerencia evaluada POR nodo disparador
      return matchingNodes.map(node => ({
        templateId: template.id,
        kind: template.kind,
        severity: template.severity,
        text: template.text,
        solution: template.solution,

        triggeringNode: {
          id: node.id,
          value: node.value
        },

        impactScore: node.value - template.minImpact
      }));
    });
  }


  /**
   * FASE 2: Detecta qué nodo del árbol está causando el mayor impacto
   * Basado en la Jerarquía de Dominancia
   */
  private detectDominantRootCause(nodes: ImpactNode[]): string | null {
    if (!nodes || nodes.length === 0) return null;

    // 1. Buscamos primero si hay un "Ganador por Dominancia Estructural" (>= 0.9)
    // Priorizamos nodos de Scalability (el "Monstruo")
    const structuralCritNode = nodes.find(n => 
      (n.id === 'recursive_expansion' || n.id === 'complexity') && n.value >= 0.9
    );

    if (structuralCritNode) {
      return structuralCritNode.id;
    }

    // 2. Si no hay dominancia absoluta, devolvemos el ID del nodo con mayor impacto
    // que supere el umbral de relevancia (0.5)
    const topNode = nodes.sort((a, b) => b.value - a.value)[0];
    
    return topNode.value >= 0.5 ? topNode.id : null;
  }

  severityRank(sev: Severity): number {
    return {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      info: 1
    }[sev];
  }

  /**
   * FASE 3: Reduce el ruido visual en el Dashboard
   * Agrupa sugerencias similares o silencia las de menor rango jerárquico
   */
  private collapseSuggestions(
    suggestions: EvaluatedSuggestion[]
  ): EvaluatedSuggestion[] {

    if (suggestions.length <= 1) return suggestions;

    // 1. Ordenamos por severidad + precedencia + impactScore
    const ordered = [...suggestions].sort((a, b) => {
      const sevDiff = this.severityRank(b.severity) - this.severityRank(a.severity);
      if (sevDiff !== 0) return sevDiff;

      const nodeDiff =
        NODE_PRECEDENCE[b.triggeringNode.id] -
        NODE_PRECEDENCE[a.triggeringNode.id];
      if (nodeDiff !== 0) return nodeDiff;

      return b.impactScore - a.impactScore;
    });

    // 2. Eliminamos sugerencias cuyo nodo ya está "explicado"
    const seenNodes = new Set<string>();
    const collapsed: EvaluatedSuggestion[] = [];

    for (const s of ordered) {
      if (seenNodes.has(s.triggeringNode.id)) continue;

      collapsed.push(s);
      seenNodes.add(s.triggeringNode.id);
    }

    // 3. Límite visual (ya ordenado)
    return collapsed.slice(0, 3);
  }




  /**
   * FASE 4: Inyección dinámica de datos en las soluciones
   * Ej: Reemplazar {val} por el cálculo de work_mem sugerido
   */
  private explainSuggestion(
    s: EvaluatedSuggestion,
    context: ExplanationContext
  ): ExplainedSuggestion {

    const node = context.dominantNodes.find(
      n => n.id === s.triggeringNode.id
    );

    const contribution = node
      ? Math.round(node.value * 100)
      : 0;

    return {
      id: s.templateId,
      kind: s.kind,
      severity: s.severity,

      title: s.text,

      explanation: this.buildExplanation(s, node, context),

      evidence: this.buildEvidence(s, context),

      recommendation: s.solution,

      impactSummary: {
        node: s.triggeringNode.id,
        value: s.triggeringNode.value,
        contribution
      }
    };
  }

  private buildExplanations(
    suggestions: EvaluatedSuggestion[],
    context: ExplanationContext
  ): ExplainedSuggestion[] {

    return suggestions.map(s =>
      this.explainSuggestion(s, context)
    );
  }

  private buildExplanation(
    s: EvaluatedSuggestion,
    node: ImpactNode | undefined,
    context: ExplanationContext
  ): string {

    if (!node) {
      return 'Se detectó un patrón de ineficiencia relevante en el plan de ejecución.';
    }

    return `
  El análisis indica que el ${node.value * 100 | 0}% del impacto total
  proviene del nodo **${node.label ?? node.id}**.

  Este patrón supera el umbral aceptable (${s.triggeringNode.value.toFixed(2)})
  y explica directamente la degradación observada en la consulta.
  `.trim();
  }

  private buildEvidence(
    s: EvaluatedSuggestion,
    context: ExplanationContext
  ): string[] {

    const evidence: string[] = [];

    if (context.plan.includes('Nested Loop')) {
      evidence.push('El plan utiliza Nested Loop con múltiples iteraciones.');
    }

    if (context.plan.includes('Rows Removed')) {
      evidence.push('Se descartan grandes volúmenes de filas tras la lectura.');
    }

    if (context.plan.includes('Recursive Union')) {
      evidence.push('Se detectó una CTE recursiva con expansión profunda.');
    }

    return evidence;
  }


}
