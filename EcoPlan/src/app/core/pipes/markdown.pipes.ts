import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

@Pipe({
  name: 'markdown',
  standalone: true
})
export class MarkdownPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';

    // 1. Convertir Markdown a HTML
    const html = marked.parse(value) as string;

    // 2. Sanitizar (Angular bloquea HTML por defecto por seguridad)
    // bypassSecurityTrustHtml le dice a Angular: "Confía en mí, este HTML es seguro"
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
