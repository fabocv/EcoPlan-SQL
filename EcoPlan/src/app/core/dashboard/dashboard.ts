import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CloudProvider, QueryImpactAnalyzer } from '../services/QueryImpactAnalyzer';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ExamplePlan, examplesExplain } from './examples';
import { ToastService } from '../services/toast.service';
import { SmartAnalysisResult, ImpactNode } from '../services/ImpactTreeManager';

const CURRENT_VERSION = "v0.9.0";

interface EcoData {
  explain: string;
  cloud: CloudProvider;
  frequency: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true, // Aseguramos que sea standalone
  imports: [
    FormsModule,
    ReactiveFormsModule,
    CommonModule,
    CurrencyPipe,
  ],
  templateUrl: 'dashboard.html',
  styles: [`
    :host { display: block; }
    .gauge-bg {
      background: conic-gradient(from 180deg at 50% 100%, var(--tw-gradient-stops));
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  version = CURRENT_VERSION;
  servicio = inject(QueryImpactAnalyzer);
  toastService = inject(ToastService);
  
  // State Signals
  ecoModel = signal<EcoData>({
    explain: '',
    cloud: 'AWS',
    frequency: 1000
  });
  analisis = signal<SmartAnalysisResult | null>(null);
  isInvalidFormat = signal<boolean>(false);
  isProcessing = signal<boolean>(false);
  
  // Static Data
  examples: ExamplePlan[] = examplesExplain;
  readonly providers: CloudProvider[] = ['AWS', 'GCP', 'Azure'];
  valueExample = signal("");

  readonly nodeDefinitions: Record<string, string> = {
    perf: "Saturación de hardware (CPU/RAM/Disco).",
    cpu: "Tiempo de procesamiento puro y JIT overhead.",
    mem: "Presión en RAM y uso de disco temporal (Disk Sort).",
    io: "Lectura de bloques (Buffers). El recurso más lento.",
    scalability: "Riesgo algorítmico al crecer el volumen de datos.",
    waste: "Filas leídas vs. filas realmente usadas.",
    complexity: "Bucles anidados, productos cartesianos o recursión.",
    eco: "Impacto ambiental estimado.",
    carbon: "Huella de carbono relativa."
  };

  // --- Actions ---

  setCloud(serviceCloud: CloudProvider) {
    this.ecoModel.update(val => ({ ...val, cloud: serviceCloud }));
    if (this.analisis()) this.recalcularCosto();
  }

  setExplain(raw: string) {
    if (raw.length > 50000) { // Aumentado un poco el límite
      raw = raw.slice(0, 50000);
      this.toastService.show('Plan truncado por exceso de longitud.', 'warning');
    }
    this.ecoModel.update(f => ({ ...f, explain: raw }));
  }

  setFrecuency(raw: number) {
    this.ecoModel.update(f => ({ ...f, frequency: raw }));
    // Debounce manual simple o validación post-input
    if (this.analisis()) this.recalcularCosto();
  }

  loadExample(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.valueExample.set(select.value);
    const example = this.examples.find(e => e.title === select.value);
    if (example) {
      this.ecoModel.update(f => ({ ...f, explain: example.content }));
      // Pequeño delay para UX
      setTimeout(() => this.procesarPlan(), 50);
    }
  }

  // --- Core Logic ---

  procesarPlan() {
    const { explain, cloud, frequency } = this.ecoModel();
    const cleanText = this.sanitizeInput(explain);

    if (!this.validarEntrada(cleanText)) return;

    this.isProcessing.set(true);

    try {
      // Validar rango frecuencia antes de llamar
      let safeFreq = frequency;
      if (safeFreq < 1) safeFreq = 1;
      if (safeFreq > 20000000) safeFreq = 20000000;

      const resultado = this.servicio.analyzePlan(cleanText, cloud, safeFreq);
      this.analisis.set(resultado);
      this.isInvalidFormat.set(false);
    } catch (e) {
      console.error(e);
      this.toastService.show("Error al analizar el plan. Verifica el formato.", "error");
      this.analisis.set(null);
    } finally {
      this.isProcessing.set(false);
    }
  }

  // Recálculo ligero sin re-parsear todo el texto si solo cambia precio/frecuencia
  private recalcularCosto() {
    if (!this.analisis()) return;
    // Nota: Idealmente el servicio tendría un método separado para recalcular solo precio,
    // pero por ahora re-ejecutamos es suficientemente rápido.
    this.procesarPlan(); 
  }

  private validarEntrada(text: string): boolean {
    if (text.length < 10 || !text.toLowerCase().includes('cost=')) {
      this.isInvalidFormat.set(true);
      return false;
    }
    return true;
  }

  private sanitizeInput(input: string): string {
    return input.replace(/<[^>]*>?/gm, '').trim();
  }

  // --- Helpers for View ---

  getImpactColor(value: number): string {
    if (value > 0.8) return 'bg-rose-500';     // Crítico
    if (value > 0.5) return 'bg-amber-500';    // Alerta
    if (value > 0.2) return 'bg-blue-400';     // Leve
    return 'bg-emerald-500';                   // Bien
  }

  getTextColor(value: number): string {
    if (value > 0.8) return 'text-rose-600';
    if (value > 0.5) return 'text-amber-600';
    return 'text-emerald-600';
  }

  esCostoInsignificante(): boolean {
    const c = this.analisis()?.economicImpact || 0;
    return c >= 0 && c < 0.01;
  }

  // Icono dinámico según el tipo de nodo
  getIconForNode(nodeId: string): string {
    switch (nodeId) {
      case 'perf': return '🚀';
      case 'cpu': return '⚙️';
      case 'mem': return '💾';
      case 'io': return '🔌';
      case 'scalability': return '📈';
      case 'waste': return '🗑️';
      case 'complexity': return '🧶';
      case 'eco': return '🌱';
      default: return '📊';
    }
  }

  // Obtener el "Top Offender" principal para mostrar en el resumen
  getPrimaryBottleneck(): ImpactNode | null {
    const offenders = this.analisis()?.topOffenders;
    if (offenders && offenders.length > 0) {
      return offenders[0]; // El de mayor valor
    }
    return null;
  }
}
