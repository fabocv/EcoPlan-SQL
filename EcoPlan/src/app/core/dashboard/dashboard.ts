import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CloudProvider, QueryImpactAnalyzer } from '../services/QueryImpactAnalyzer';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ExamplePlan, examplesExplain } from './examples';
import { ToastService } from '../services/toast.service';
import { SmartAnalysisResult, ImpactNode } from '../services/ImpactTreeManager';
import { MarkdownPipe } from '../pipes/markdown.pipes';

const CURRENT_VERSION = 'v1.0.3'; // Dark Mode Update

interface EcoData {
  explain: string;
  cloud: CloudProvider;
  frequency: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, CommonModule, CurrencyPipe, MarkdownPipe],
  templateUrl: 'dashboard.html',
  styles: [
    `
      :host {
        display: block;
      }
      /* Ajuste para resaltar nodo en Dark Mode */
      .node-focused {
        box-shadow: 0 0 0 2px #38bdf8; /* Sky-400 ring */
        background-color: rgba(14, 165, 233, 0.15); /* Sky tint very subtle */
      }

      /* Scrollbar minimalista oscuro */
      .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
      }
      .custom-scrollbar::-webkit-scrollbar-track {
        background: #0f172a;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background-color: #334155;
        border-radius: 20px;
      }
    `,
  ],
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
    frequency: 1000,
  });

  analisis = signal<SmartAnalysisResult | null>(null);
  isInvalidFormat = signal<boolean>(false);
  isProcessing = signal<boolean>(false);

  activeNodeId = signal<string | null>(null);

  // Static Data
  examples: ExamplePlan[] = examplesExplain;
  readonly providers: CloudProvider[] = ['AWS', 'GCP', 'Azure'];
  valueExample = signal('');

  readonly nodeDefinitions: Record<string, string> = {
    perf: 'Saturación de hardware (CPU/RAM/Disco).',
    cpu: 'Tiempo de procesamiento puro y JIT overhead.',
    mem: 'Presión en RAM y uso de disco temporal (Disk Sort).',
    io: 'Lectura de bloques (Buffers). El recurso más lento.',
    scalability: 'Riesgo algorítmico al crecer el volumen de datos.',
    waste: 'Filas leídas vs. filas realmente usadas.',
    complexity: 'Bucles anidados, productos cartesianos o recursión.',
    eco: 'Impacto ambiental estimado.',
    carbon: 'Huella de carbono relativa.',
  };

  // --- Actions ---

  setCloud(serviceCloud: CloudProvider) {
    this.ecoModel.update((val) => ({ ...val, cloud: serviceCloud }));
    if (this.analisis()) this.recalcularCosto();
  }

  setExplain(raw: string) {
    if (raw.length > 100000) {
      raw = raw.slice(0, 100000);
      this.toastService.show('Plan truncado por exceso de longitud.', 'warning');
    }
    this.ecoModel.update((f) => ({ ...f, explain: raw }));
  }

  setFrecuency(raw: number) {
    this.ecoModel.update((f) => ({ ...f, frequency: raw }));
    if (this.analisis()) this.recalcularCosto();
  }

  loadExample(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.valueExample.set(select.value);
    const example = this.examples.find((e) => e.title === select.value);
    if (example) {
      this.ecoModel.update((f) => ({ ...f, explain: example.content }));
      setTimeout(() => this.procesarPlan(), 50);
    }
  }

  focusNode(nodeId: string) {
    if (!nodeId) return;
    this.activeNodeId.set(nodeId);
    this.toastService.show(`Resaltando nodo: ${nodeId}`, 'info');
    const element = document.getElementById(`node-${nodeId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // --- Core Logic ---

  procesarPlan() {
    const { explain, cloud, frequency } = this.ecoModel();
    const cleanText = this.sanitizeInput(explain);

    if (!this.validarEntrada(cleanText)) return;

    this.isProcessing.set(true);
    this.activeNodeId.set(null);

    try {
      let safeFreq = frequency;
      if (safeFreq < 1) safeFreq = 1;
      if (safeFreq > 20000000) safeFreq = 20000000;

      const resultado = this.servicio.analyzePlan(cleanText, cloud, safeFreq);
      this.analisis.set(resultado);
      this.isInvalidFormat.set(false);
    } catch (e) {
      console.error(e);
      this.toastService.show('Error al analizar el plan. Verifica el formato.', 'error');
      this.analisis.set(null);
    } finally {
      this.isProcessing.set(false);
    }
  }

  private recalcularCosto() {
    if (!this.analisis()) return;
    this.procesarPlan();
  }

  private validarEntrada(text: string): boolean {
    if (text.length < 10) {
      this.isInvalidFormat.set(true);
      return false;
    }
    const keywords = ['Scan', 'Join', 'Loop', 'Cost=', 'cost='];
    const hasKeyword = keywords.some((k) => text.includes(k));

    if (!hasKeyword) {
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
    // Backgrounds can stay mostly the same, or slightly dimmer
    if (value > 0.8) return 'bg-rose-500';
    if (value > 0.5) return 'bg-amber-500';
    if (value > 0.2) return 'bg-sky-500'; // Sky 400 is too bright for bar fills sometimes
    return 'bg-emerald-500';
  }

  getTextColor(value: number): string {
    // IMPORTANT: Lighter colors for Dark Mode text contrast (400 instead of 600)
    if (value > 0.8) return 'text-rose-400';
    if (value > 0.5) return 'text-amber-400';
    return 'text-emerald-400';
  }

  esCostoInsignificante(): boolean {
    const c = this.analisis()?.economicImpact || 0;
    return c >= 0 && c < 0.01;
  }

  getIconForNode(nodeId: string): string {
    const id = nodeId.toLowerCase();

    if (id.includes('scan')) return '🔍';
    if (id.includes('join')) return '🔗';
    if (id.includes('sort')) return '📶';
    if (id.includes('agg')) return '∑';

    switch (id) {
      case 'perf':
        return '🚀';
      case 'cpu':
        return '⚙️';
      case 'mem':
        return '💾';
      case 'io':
        return '🔌';
      case 'scalability':
        return '📈';
      case 'waste':
        return '🗑️';
      case 'complexity':
        return '🧶';
      case 'eco':
        return '🌱';
      case 'recursive_expansion':
        return '🔄';
      default:
        return '📊';
    }
  }

  getPrimaryBottleneck(): ImpactNode | null {
    const offenders = this.analisis()?.topOffenders;
    if (offenders && offenders.length > 0) {
      return offenders[0];
    }
    return null;
  }
}
