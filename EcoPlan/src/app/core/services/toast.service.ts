import { Injectable, signal } from '@angular/core';

export interface Toast {
  message: string;
  type: 'error' | 'warning' | 'info';
  id: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts = signal<Toast[]>([]);

  show(message: string, type: Toast['type'] = 'info') {
    const id = Date.now();
    this.toasts.update(t => [...t, { id, message, type }]);
    
    // Auto-eliminar después de 4 segundos
    setTimeout(() => this.remove(id), 4000);
  }

  remove(id: number) {
    this.toasts.update(t => t.filter(toast => toast.id !== id));
  }
}