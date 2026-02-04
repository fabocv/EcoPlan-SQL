import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CloudProvider, QueryImpactAnalyzer, AnalysisResult } from '../services/QueryImpactAnalyzer';
import { form, FormField } from '@angular/forms/signals';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

interface EcoData {
  explain: string;
  cloud: CloudProvider;
}

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule,
    FormField,
    ReactiveFormsModule,],
  templateUrl: 'dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  servicio = inject(QueryImpactAnalyzer)
  planText = signal("{text:''}");
  cloud = signal<CloudProvider>("AWS");
  analisis = signal<string>("")
  ecoModel = signal<EcoData>({
    explain: '',
    cloud: 'AWS',
  });
  ecoForm = form(this.ecoModel)

  setCloud(serviceCloud: CloudProvider) {
    this.ecoForm.cloud().value.set(serviceCloud);
  }

  calcular() {
    const texto = this.ecoModel().explain;
    const cloudService = this.ecoModel().cloud;
    const res: AnalysisResult = this.servicio.analyze(texto, cloudService)
    console.log(this.cloud(), res);
    this.analisis.set(
      '\nImpacto economico: $' + res.economicImpact.toFixed(2) + "USD (Proyectado Mensual)" +
      '\nPuntuaje de eficiencia: ' + res.efficiencyScore.toFixed(2) +
      '\nTiempo de ejecución: ' + res.executionTimeMs + " ms" +
      '\nSugerencias: ' + res.suggestions
    );
  }
}
