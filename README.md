# 🛡️ EcoPlan SQL
> **Transforming database execution plans into business and environmental insights.**

EcoPlan SQL es una herramienta de CLI (Command Line Interface) diseñada para desarrolladores y equipos de FinOps que buscan optimizar el rendimiento de PostgreSQL. A diferencia de los visualizadores tradicionales, EcoPlan traduce el `EXPLAIN ANALYZE` en **costos reales de nube** e **impacto de huella de carbono**.



## 🚀 Características Principales

* **Financial Auditing:** Calcula el costo mensual estimado de una query basado en el proveedor de nube (AWS, GCP, Azure).
* **Eco-Efficiency Score:** Mide la eficiencia energética de tus consultas y proyecta la huella de CO2 generada.
* **Smart Suggestions:** Detecta antipatrones como Index Bloat, Sequential Scans masivos y desbordamientos a disco (Disk Spill).
* **Cloud Agnostic:** Tarifas preconfiguradas para los principales proveedores del mercado.

## 🛠️ Tecnologías

* **TypeScript / Node.js** - Núcleo de procesamiento.
* **Angular 21** - EL dashboard web

## 📦 Instalación

```bash
git clone [https://github.com/fabocv/EcoPlan-SQL.git](https://github.com/fabocv/EcoPlan-SQL.git)
cd ecoplan-sql/EcoPlan
npm install
```