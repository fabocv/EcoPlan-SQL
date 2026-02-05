import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CloudProvider, QueryImpactAnalyzer, AnalysisResult, voidAnalysis } from '../services/QueryImpactAnalyzer';
import { FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ExamplePlan, examplesExplain } from './examples';

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
  servicio = inject(QueryImpactAnalyzer)
  planText = signal("{text:''}");
  cloud = signal<CloudProvider>("AWS");
  analisis = signal<AnalysisResult>(voidAnalysis)
  ecoModel = signal<EcoData>({
    explain: '',
    cloud: 'AWS',
    frequency: 1000
  });
  //ecoForm = form(this.ecoModel)
  
  
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
    this.ecoModel.update(f => ({ ...f, explain:raw }));
  }

  setFrecuency( raw: number ) {
    this.ecoModel.update(f => ({ ...f, frequency:raw }));
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
    
    if (!valor || valor < 1) valor = 1;
    if (valor > 2000000) valor = 2000000;
    
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
