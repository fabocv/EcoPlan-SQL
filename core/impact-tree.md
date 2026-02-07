# Especificación Técnica: EcoPlan-SQL v0.8.1 (Impact Tree Model)

Esta versión evoluciona el motor de análisis de una estructura plana a un **Árbol de Impacto Jerárquico**. El modelo v0.8 introduce conciencia de infraestructura (Paralelismo, JIT) y tipos de datos complejos (JSONB), permitiendo una trazabilidad total entre el plan de ejecución y las recomendaciones FinOps.

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

## 2. Lógica de Normalización y Umbrales

Para evitar "alucinaciones" en las métricas, aplicamos saturación logarítmica en variables exponenciales y lineales en desperdicio.

$$Value = \text{clamp}\left(\frac{\log_2(\text{actual\_value})}{\log_2(\text{critical\_threshold})}, 0, 1\right)$$

### Calibración de Umbrales Críticos (v0.8.1):
| Métrica | Óptimo (0.0) | Crítico (1.0) | Notas de la v0.8.1 |
| :--- | :--- | :--- | :--- |
| **Waste Ratio** | < 5% | > 90% | Se volvió más estricto para detectar JSONB. |
| **Hash Batches** | 1 batch | 128 batches | Detecta falta de `work_mem`. |
| **Worker Loss** | 0 diff | > 2 workers | Penaliza si `Planned > Launched`. |
| **Heap Fetches** | 0 rows | > 1,000 rows | Evalúa si un Index Scan necesita VACUUM. |

---

## 3. Motor de Recomendaciones Inteligentes (Smart Suggester)

La v0.8.1 implementa un **Filtro de Exclusión y Deduplicación** para mantener los reportes limpios:

1.  **Prioridad de Join:** Si se detecta un `Nested Loop` con alto impacto, se silencia la alerta de `RECURSIVE_UNION` para evitar falsos positivos de recursión en productos cartesianos.
2.  **Detección JSONB:** Se activa específicamente cuando el plan contiene operadores `->>`, `@>` o `?` y el `Waste Ratio` supera el 0.7.
3.  **Conciencia de Infraestructura:** Compara `Workers Planned` vs `Workers Launched`. Si hay discrepancia, dispara una alerta de **Resource Contention** por encima de las alertas de filtrado.

---

## 4. Algoritmo de Agregación

```typescript
function resolve(node: ImpactNode): number {
  if (!node.children || node.children.length === 0) return node.value;
  
  const totalWeight = node.children.reduce((acc, child) => acc + child.weight, 0);
  const weightedSum = node.children.reduce((acc, child) => 
    acc + (resolve(child) * child.weight), 0);
    
  return weightedSum / totalWeight;
}
```