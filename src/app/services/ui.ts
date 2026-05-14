import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'info';
}

@Injectable({
  providedIn: 'root'
})
export class UIService {
  isFullScreen = signal<boolean>(false);
  
  private confirmResolver?: (value: boolean) => void;
  confirmation = signal<ConfirmOptions | null>(null);

  toggleFullScreen() {
    this.isFullScreen.update(v => !v);
  }

  setFullScreen(value: boolean) {
    this.isFullScreen.set(value);
  }

  confirm(options: ConfirmOptions): Promise<boolean> {
    this.confirmation.set({
      confirmText: 'Confirm',
      cancelText: 'Cancel',
      type: 'info',
      ...options
    });
    return new Promise((resolve) => {
      this.confirmResolver = resolve;
    });
  }

  resolveConfirm(result: boolean) {
    this.confirmation.set(null);
    if (this.confirmResolver) {
      this.confirmResolver(result);
      this.confirmResolver = undefined;
    }
  }
}
