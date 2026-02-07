import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CloudProvider, QueryImpactAnalyzer, AnalysisResult, voidAnalysis } from '../services/QueryImpactAnalyzer';
import { FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ExamplePlan, examplesExplain } from './examples';
import { ToastService } from '../services/toast.service';
import { SmartAnalysisResult } from '../services/ImpactTreeManager';

const CURRENT_VERSION = "v0.8"
interface EcoData {
  explain: string;
  cloud: CloudProvider;
  frequency: number;
}

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule,
    ReactiveFormsModule,
    CommonModule,
    CurrencyPipe,
  ],
  templateUrl: 'dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  version = CURRENT_VERSION;
  servicio = inject(QueryImpactAnalyzer)
  toastService = inject(ToastService);
  planText = signal("{text:''}");
  cloud = signal<CloudProvider>("AWS");
  analisis = signal<SmartAnalysisResult | null>(null)
  ecoModel = signal<EcoData>({
    explain: '',
    cloud: 'AWS',
    frequency: 1000
  });

  isInvalidFormat = signal<boolean>(false);
  examples: ExamplePlan[] = examplesExplain;
  readonly providers: CloudProvider[] = ['AWS', 'GCP', 'Azure'];
  valueExample = signal("");

  readonly nodeDefinitions: Record<string, string> = {
    perf: "Impacto directo en el tiempo de respuesta y consumo de hardware actual.",
    cpu: "Presión sobre los núcleos del procesador. Incluye tiempos de ejecución y compilación JIT.",
    mem: "Uso de memoria RAM. Valores altos indican que los datos están desbordando al disco duro.",
    io: "Lectura y escritura física en disco. Es el cuello de botella más lento y costoso.",
    scalability: "Riesgo de que la consulta colapse o se vuelva extremadamente cara al aumentar los datos.",
    waste: "Eficiencia del filtrado. Mide cuántas filas se leyeron pero terminaron descartándose.",
    complexity: "Riesgo estructural: presencia de productos cartesianos, bucles infinitos o recursión profunda."
  };

  private sanitizeInput(input: string): string {
    // Elimina cualquier intento de tags HTML para evitar XSS
    return input.replace(/<[^>]*>?/gm, '').trim();
  }

  setCloud(serviceCloud: CloudProvider) {
    this.ecoModel.update(val => ({ ...val, cloud: serviceCloud }));
  }

  setExplain( raw: string ) {
    if (raw.length>10000) {
      raw = raw.slice(0,10000);
      this.toastService.show('Plan demasiado largo para el baseline.', 'warning');
    }
    this.ecoModel.update(f => ({ ...f, explain:raw }));
  }

  setFrecuency( raw: number ) {
    this.ecoModel.update(f => ({ ...f, frequency:raw }));
    this.validarRango();
  }

  procesarPlan() {
    const { explain, cloud, frequency } = this.ecoModel();

    // Sanitización básica
    const cleanText = explain.trim();

    if (cleanText.length < 10 || !cleanText.toLowerCase().includes('cost=')) {
      this.isInvalidFormat.set(true);
      return;
    }

    this.isInvalidFormat.set(false);
    
    // El servicio ahora devuelve el objeto con el ImpactTree
    const resultado = this.servicio.analyze(cleanText, cloud, frequency);
    
    // Actualizamos el signal con la nueva estructura
    this.analisis.set(resultado); 
  }

  // Helper para el HTML: Obtener color según el valor (0 a 1)
  getImpactColor(value: number): string {
    if (value > 0.7) return 'bg-red-500';
    if (value > 0.4) return 'bg-amber-500';
    return 'bg-emerald-500';
  }


  calcular() {
    this.validarRango();
    const rawText = this.ecoModel().explain;
    const cloudService = this.ecoModel().cloud;
    let frequency = this.ecoModel().frequency;
    if (frequency < 1) frequency = 1;
    if (frequency > 2000000) frequency = 2000000;

    const cleanText = this.sanitizeInput(rawText);

    const isValid = cleanText.length > 10 && 
                    cleanText.toLowerCase().includes('cost=') && 
                    cleanText.toLowerCase().includes('rows=');

    if (!isValid) {
      this.isInvalidFormat.set(true);
      this.analisis.set(null);
      return;
    }

    this.isInvalidFormat.set(false);
    const res = this.servicio.analyze(cleanText, cloudService, frequency);
    
    this.analisis.set({ ...res }); 
  }


  esCostoInsignificante(): boolean {
    const c = this.analisis()?.economicImpact || 0;
    return c >= 0 && c < 0.01;
  }

  validarRango() {
    let valor = Math.floor(this.ecoModel().frequency); // Asegurar entero
    let showToast = false
    if (!valor || valor < 1) {valor = 1; showToast = true}
    if (valor > 2000000) {valor = 2000000; showToast = true}

    if (showToast) this.toastService.show('Frecuencia debe estar en el rango 1 a 2 millones.', 'warning');
    
    this.ecoModel.update(f => ({
      ...f,
      frequency: valor
    }));
  }

  analisisCorrecto(): boolean {
    return !!this.analisis();
  }


  

  // Función para cargar el ejemplo seleccionado
  loadExample(event: Event) {
    this.validarRango();
    const select = event.target as HTMLSelectElement;
    this.valueExample.set(select.value);
    const example = this.examples.find(e => e.title === select.value);
    if (example) {
      this.ecoModel.update(f => ({
        ...f,
        explain: example.content
      }));
      setTimeout(() => this.procesarPlan(), 100);
    }
  }
}
