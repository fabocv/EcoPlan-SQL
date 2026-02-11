# Especificación Técnica: EcoPlan-SQL v0.8.x (Impact Tree Model)

Esta versión evoluciona el motor de análisis de una estructura plana a un **Árbol de Impacto Jerárquico**. El modelo v0.8 introduce conciencia de infraestructura (Paralelismo, JIT) y tipos de datos complejos (JSONB), permitiendo una trazabilidad total entre el plan de ejecución y las recomendaciones FinOps.

En la version 0.8.2, se introducen capacidades para detectar fallos en particionamiento, optimización de almacenamiento (índices parciales)

# Definiciones para analizar y calcular explains

## Estructura de Costos por Proveedores

Para las versiones de **EcoPlan-SQL** `v<2.0`, los costos operacionales por proveedores sera un *valor único promediado*. El proveedor escogido se define mediante  `CloudProvider` y su estructura de precio básica se define por `CloudPricing`. Las tasas definidas se indican en `CLOUD_RATES`

```typescript
export type CloudProvider = 'AWS' | 'GCP' | 'Azure';


interface CloudPricing {
  computeUnitCostPerMs: number; // Costo estimado por ms de CPU
  ioCostPerBuffer: number;      // Costo por cada 8kb (buffer) leído
}

const CLOUD_RATES: Record<CloudProvider, CloudPricing> = {
  AWS:   { computeUnitCostPerMs: 0.000012, ioCostPerBuffer: 0.0000005 },
  GCP:   { computeUnitCostPerMs: 0.000010, ioCostPerBuffer: 0.0000004 },
  Azure: { computeUnitCostPerMs: 0.000011, ioCostPerBuffer: 0.0000006 }
};
```

Por coeficientes encontrados en el explain podemos determinar costos ponderados bajo coeficientes energéticos de RAM, Disco, ram temporal y disco temporal, tal como se describe en `ENERGY_COEFFICIENTS`

```typescript
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
```
---

## Estructuras para metrificar y entender los explain

El contrato para movilizar los datos para obtener los impactos y sus sugerencias está definido por `RawMetrics`. Este objeto es generado por la función `extractAllMetrics(...)` que obtiene y calcula valores que extrae mediante **expresiones regulares (regex)** sobre la entrada del explain.

```typescript
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
  rowsPerIteration: number;
  seqScanInLoop: boolean,
}
```
Luego, tenemos otro contrato para mover los resultados condensados de las métricas crudas. Dicha interfaz es `SmartAnalysisResult`. Esta estructura de datos es enviada al controlador del frontend y es procesada por el servicio.

```typescript
interface SmartAnalysisResult {
  executionTimeMs: number;
  economicImpact: number;
  suggestions: {list: string[], solucion: string[]};
  efficiencyScore: number;
  provider: CloudProvider;
  execTimeInExplain: boolean;
  impactTree: ImpactNode;
  topOffenders: ImpactNode[];
  breakdown: string; 
}
```

---
## Estructura de árbol de impacto: EcoSQLTree

Se define un arbol cuyas hojas se modelan con la interface `ImpactNode`

```typescript
export interface ImpactNode {
  id: string;
  label: string;
  value: number;        // 0.0 a 1.0 (normalizado)
  weight: number;       // Peso relativo frente a sus hermanos
  children?: ImpactNode[];
  isCritical?: boolean;
  description?: string; // Para explicar el "porqué" al usuario
}
```


## 1. Arquitectura del Árbol de Impacto

El impacto total se calcula mediante la agregación de tres pilares. Cada nodo hoja tiene un valor normalizado de $0.0$ a $1.0$, donde $1.0$ representa una saturación crítica de recursos.

### Estructura de Nodos (Jerarquía de Pesos)

* **Performance Impact (Peso: 0.50)**
    * **CPU Pressure:** `execution_time`, `jit_overhead`, `parallel_worker_efficiency`.
    * **Memory Pressure:** `hash_batches` (log), `sort_spill`, `work_mem_ratio`.
    * **I/O Pressure:** `buffers_read` (8kb), `temp_files_mb`, `heap_fetches_ratio`.
* **Scalability Risk (Peso: 0.35)** * **Data Volume:** `waste_ratio` (rows removed vs total), `seq_scan_large_tables`.
    * **Complexity:** `loops_intensity`, `recursive_depth`, `cartesian_products`.
    * **Resource Contention:** `parallel_worker_starvation` (Planned vs Launched).
* **Eco Impact (Peso: 0.15)**
    * **Carbon Footprint:** Estimación de Watts basada en `(CPU_time * 0.4) + (I/O_activity * 0.6)`.

---
```
TOTAL QUERY IMPACT (Raíz) [Peso: 1.0]
┃
┣━━ PERFORMANCE IMPACT [Peso: 0.50]
┃   ┣━━ CPU Pressure (Intensidad de ejecución y JIT)
┃   ┣━━ Memory Pressure (Trigger: WORK_MEM_LIMIT)
┃   ┗━━ I/O Pressure (Trigger: DISK_SORT / RECURSIVE_EXPLOSION)
┃
┣━━ SCALABILITY RISK [Peso: 0.35]
┃   ┣━━ Recursive Expansion [Trigger: RECURSIVE_BOMB]
┃   ┣━━ Structural Complexity [Trigger: NESTED_LOOP / CARTESIAN]
┃   ┣━━ Data Waste [Trigger: WASTE_FILTER / PARTIAL_INDEX]
┃   ┗━━ Resource Contention [Trigger: PARALLEL_FAIL / DEGRADED]
┃
┗━━ ECO IMPACT [Peso: 0.15]
    ┗━━ Carbon Footprint (Función de Watts: CPU + I/O)
```

## 2. Lógica de Normalización y Umbrales

Para evitar "alucinaciones" en las métricas, aplicamos saturación logarítmica en variables exponenciales y lineales en desperdicio.

$$Value = \text{clamp}\left(\frac{\log_2(\text{actual\_value})}{\log_2(\text{critical\_threshold})}, 0, 1\right)$$

## 3. Calibración de Umbrales Críticos (v0.8.3):
| Métrica | Óptimo (0.0) | Crítico (1.0) | Notas de la v0.9.x|
| :--- | :--- | :--- | :--- |
| Waste Ratio | < 5% | > 90% | Crucial para detectar escaneos ineficientes en JSONB.|
| Hash Batches | 1 batch | 128 batches | Indica saturación de work_mem y desborde a disco.|
| Worker Loss | 0 diff | > 2 workers | Penaliza la falta de recursos para paralelismo (Starvation).|
| Heap Fetches | 0 rows | "> 1000 rows" | Evalúa la necesidad de VACUUM por sobrecarga de visibilidad.|
| Recursive Depth | 1-2 niveles | > 10 niveles | Detecta riesgos de explosión combinatoria en CTEs.|
| Loops Intensity | 1 loop | > 100k loops | Identifica Nested Loops ineficientes que deben ser Hash Joins.|
| Temp Files | 0 MB | > 512 MB | Umbral crítico de I/O temporal que dispara el Eco Impact.|

## 4. Operadores del árbol

### Resolve
```public resolve(node: ImpactNode): number``` 

Calcula el valor de un nodo basado en sus hijos (Weighted Average)

### Flatten *(aplanar)*
```public flatten(node: ImpactNode, results: ImpactNode[] = []): ImpactNode[] ``` 

Aplana el árbol para buscar los mayores problemas (Top Offenders)

### getTopOffenders
```public getTopOffenders(node: ImpactNode): ImpactNode[] ``` 

Obtiene los 3 cuellos de botella más importantes

### logNormalize
```public logNormalize(actual: number, critical: number): number```

Normalización Logarítmica para métricas que escalan rápido

## 5. Operadores de Cálculo (Scoring)


$$Total\_Impact=0.5⋅P+0.3⋅R+0.2⋅E$$

donde:
$$P = Performance Impact ∈ [0,1]$$
$$R = Scalability Risk ∈ [0,1]$$
$$E = Eco Impact ∈ [0,1]$$

Y cada uno de esos es:

$$P=f(CPU,Memoria,IO)$$
$$R=f(Complejidad,Estructura,Datos)$$
$$E=f(CPU,IO,Tiempo)$$

Es un modelo multicriterio ponderado.

---
### Normalización:

Logarítmica para:

- execution time
- batches
- temp files

Lineal para:

- waste ratio
- flags binarios

Esto cumple tres propiedades importantes:

#### Monotonía
Más costo → mayor impacto

#### Saturación
No explota con outliers

#### Comparabilidad
Todas las métricas viven en $[0,1]$

---
### Agregado jerarquico

Estamos variando a burbujeo dinámico para calcular el mayor nodo hacia arriba de las hojas (hasta el padre).

Actualmente  los hijos representan contribuciones independientes y ningún hijo debe dominar completamente. Resuelto parcialmente con **dominancia** y nodos estructurales, aunque se traba en ciertos casos.

Regla de dominancia:

> Si un nodo estructural ≥ 0.9 → el impacto total ≥ 0.85 (hard floor)

### Puntaje de eficiencia

Se cambiara (o renombrará) como `EfficencyScore` pues es un índice comparativo definido como: 
$$EfficencyScore = (1−Total\_Impact)×100$$

### Eco Impact

Eco Impact NO debe ser independiente, debe ser función del árbol, no una tercera penalización paralela, definida como:
 
 $$E=α⋅CPU+β⋅IO$$

### Cap global de saturación

Define explícitamente:

$$Total\_Impact=min⁡(1,Total Impact)$$

## 6. Cálculo de sugerencias 

La nueva función de sugerencias debe operar sobre el estado ya interpretado, no sobre datos crudos, porque:

> - los nodos del árbol ya representan toda la semántica
> - el plan solo sirve para detectar patrones estructurales
> - las métricas crudas ya no deberían influir


|Operadores  | Fase y función |
|------------|------------------|
| generateSuggestions()     | Fase 1 (qué aplica)|
| detectDominantRootCause() | Fase 2 (por qué)|
| collapseSuggestions()     | Fase 3 (evitar ruido)|
| finalizeSuggestions()     | Fase 4 (qué mostrar)|

| Fase                | Usa                    |
| ------------------- | ---------------------- |
| Fase 1 – Evaluación | `plan`, `impact nodes` |
| Fase 2 – Root cause | `impact tree`          |
| Fase 3 – Colapso    | `dominant nodes`       |
| Fase 4 – Output     | texto + severidad      |

### Nueva función *generateSmartSuggestions*
```typescript
private generateSmartSuggestions(
  context: SuggestionContext
): EvaluatedSuggestion[]
```

```typescript
interface SuggestionContext {
  impactTree: ImpactNode;              // raíz del árbol
  dominantNodes: ImpactNode[];          // top offenders ya calculados
  structuralFlags: StructuralFlags;     // nested loop, recursion, cartesian
}
```
Nueva estructura de flags de criticidades estructurales:

```typescript
interface StructuralFlags {
  // Join & loops
  hasNestedLoop: boolean;
  hasCartesianProduct: boolean;
  hasSeqScanInLoop: boolean;

  // Recursion & materialization
  hasRecursiveCTE: boolean;
  hasForcedMaterialization: boolean;

  // Planner quality
  hasRowEstimateDrift: boolean;
  hasLateFiltering: boolean;

  // Memory & IO structure
  hasExternalSortOrHash: boolean;

  // Parallelism
  hasWorkerStarvation: boolean;
}```

