# EcoPlan SQL
> **Transforming database execution plans into business and environmental insights.**

EcoPlan SQL es una herramienta diseñada para desarrolladores y equipos de FinOps que buscan optimizar el rendimiento de PostgreSQL. A diferencia de los visualizadores tradicionales, EcoPlan traduce el `EXPLAIN ANALYZE` en **costos reales de nube** e **impacto de huella de carbono**.



## Características Principales

* **Financial Auditing:** Calcula el costo mensual estimado de una query basado en el proveedor de nube (AWS, GCP, Azure).
* **Eco-Efficiency Score:** Mide la eficiencia energética de tus consultas y proyecta la huella de CO2 generada.
* **Smart Suggestions:** Detecta antipatrones como Index Bloat, Sequential Scans masivos y desbordamientos a disco (Disk Spill).
* **Cloud Agnostic:** Tarifas preconfiguradas para los principales proveedores del mercado.

### Estructura de cálculo por Nodos (versión v0.7+)

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

 > Mas detalles, revisa la estrategia [en este link](./core/impact-tree.md)

## Tecnologías

* **TypeScript / Node.js** - Núcleo de procesamiento.
* **Angular 21** - EL dashboard web

### [Visita EcoPlan-SQL Online](https://fabocv.github.io/EcoPlan-SQL/)

## Instalación

```bash
git clone [https://github.com/fabocv/EcoPlan-SQL.git](https://github.com/fabocv/EcoPlan-SQL.git)
cd ecoplan-sql/EcoPlan
npm install
```
