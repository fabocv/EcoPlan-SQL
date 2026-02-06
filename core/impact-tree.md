# Especificación Técnica: EcoPlan-SQL v0.7 - v1.0 (Impact Tree Model)

Esta versión evoluciona el motor de análisis de una estructura plana de `ifs` a un **Árbol de Impacto Jerárquico**. Este modelo permite una trazabilidad total: cada sugerencia está respaldada por un nodo matemático, evitando la doble penalización y permitiendo explicar el "porqué" de cada score.

## 1. Arquitectura del Árbol de Impacto

El impacto total se calcula mediante la agregación de tres pilares principales. Cada hoja tiene un valor normalizado ($0.0$ a $1.0$).

### Estructura de Nodos

* **Performance Impact (Peso: 0.50)**
    * **CPU Pressure:** `execution_time` (ms), `jit_overhead` (ms), `function_calls`.
    * **Memory Pressure:** `hash_batches` (log), `sort_spill` (boolean), `work_mem_ratio`.
    * **I/O Pressure:** `buffers_read` (8kb), `temp_files_mb`, `disk_sort`.
* **Scalability Risk (Peso: 0.30)**
    * **Data Volume:** `waste_ratio` (rows removed vs total), `seq_scan_large_tables`.
    * **Complexity:** `loops_intensity`, `recursive_depth`, `jit_compilation_time`.
    * **Structural:** `cartesian_products`, `parallel_worker_dependency`.
* **Eco Impact (Peso: 0.20)**
    * **Carbon Footprint:** Estimación de Watts basada en `(CPU_time * 0.4) + (I/O_activity * 0.6)`.

---

## 2. Lógica de Normalización Logarítmica

Para variables que crecen exponencialmente (como los Batches de memoria o archivos temporales), aplicamos la siguiente fórmula de saturación:

$$Value = \text{clamp}\left(\frac{\log_2(\text{actual\_value})}{\log_2(\text{critical\_threshold})}, 0, 1\right)$$

### Ejemplo de Umbrales Críticos:
| Métrica | Óptimo (0.0) | Crítico (1.0) | Comportamiento |
| :--- | :--- | :--- | :--- |
| **Hash Batches** | 1 batch | 128 batches | Logarítmico |
| **Waste Ratio** | < 10% | > 95% | Lineal |
| **Temp Files** | 0 MB | 512 MB | Logarítmico |
| **Execution Time**| < 100ms | > 10,000ms | Logarítmico |

---

## 3. Algoritmo de Agregación (Weighted Average)

Para evitar que un valor bajo "maquille" un problema grave, el padre calcula su valor así:

```typescript
function calculateNodeValue(node: ImpactNode): number {
  if (!node.children || node.children.length === 0) return node.value;
  
  const totalWeight = node.children.reduce((acc, child) => acc + child.weight, 0);
  const weightedSum = node.children.reduce((acc, child) => 
    acc + (calculateNodeValue(child) * child.weight), 0);
    
  return weightedSum / totalWeight;
}