import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CloudProvider, QueryImpactAnalyzer, AnalysisResult, voidAnalysis } from '../services/QueryImpactAnalyzer';
import { FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ExamplePlan, examplesExplain } from './examples';
import { ToastService } from '../services/toast.service';

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
  version = "v0.6";
  servicio = inject(QueryImpactAnalyzer)
  toastService = inject(ToastService);
  planText = signal("{text:''}");
  cloud = signal<CloudProvider>("AWS");
  analisis = signal<AnalysisResult>(voidAnalysis)
  ecoModel = signal<EcoData>({
    explain: '',
    cloud: 'AWS',
    frequency: 1000
  });

  isInvalidFormat = signal<boolean>(false);
  examples: ExamplePlan[] = examplesExplain;
  readonly providers: CloudProvider[] = ['AWS', 'GCP', 'Azure'];
  valueExample = signal("");

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
      this.analisis.set(voidAnalysis);
      return;
    }

    this.isInvalidFormat.set(false);
    const res = this.servicio.analyze(cleanText, cloudService, frequency);
    
    this.analisis.set({ ...res }); 
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
    return this.analisis().executionTimeMs > 0;
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
      setTimeout(() => this.calcular(), 100);
    }
  }
}
