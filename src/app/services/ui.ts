import { TranslationService } from './translation';
import { inject, Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'info';
}

@Injectable({
  providedIn: 'root',
})
export class UIService {
  private ts = inject(TranslationService);
  isFullScreen = signal<boolean>(false);
  showOnboarding = signal<boolean>(false);
  currentTheme = signal<Theme>('light');

  private confirmResolver?: (value: boolean) => void;
  confirmation = signal<ConfirmOptions | null>(null);

  deferredPrompt = signal<any>(null);

  constructor() {
    this.checkOnboarding();
    this.initPwaLogic();
    this.loadTheme();
  }

  private loadTheme() {
    const saved = localStorage.getItem('trackingfy_theme') as Theme;
    if (saved === 'light' || saved === 'dark') {
      this.setTheme(saved);
    } else {
      const prefersDark =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.setTheme(prefersDark ? 'dark' : 'light');
    }
  }

  setTheme(theme: Theme) {
    this.currentTheme.set(theme);
    localStorage.setItem('trackingfy_theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  private initPwaLogic() {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      this.deferredPrompt.set(e);
    });
  }

  async installPwa() {
    const prompt = this.deferredPrompt();
    if (!prompt) return;

    // Show the install prompt
    prompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      console.log('User accepted the PWA install prompt');
    } else {
      console.log('User dismissed the PWA install prompt');
    }
    // We've used the prompt, and can't use it again, throw it away
    this.deferredPrompt.set(null);
  }

  isOnboardingCompleted = signal<boolean>(localStorage.getItem('trackingfy_onboarding') === 'true');

  private checkOnboarding() {
    const hasSeen = localStorage.getItem('trackingfy_onboarding');
    if (!hasSeen) {
      this.showOnboarding.set(true);
    }
  }

  completeOnboarding() {
    localStorage.setItem('trackingfy_onboarding', 'true');
    this.isOnboardingCompleted.set(true);
    this.showOnboarding.set(false);
  }

  toggleFullScreen() {
    this.isFullScreen.update((v) => !v);
  }

  setFullScreen(value: boolean) {
    this.isFullScreen.set(value);
  }

  confirm(options: ConfirmOptions): Promise<boolean> {
    this.confirmation.set({
      confirmText: this.ts.t('confirm.btn.confirm'),
      cancelText: this.ts.t('confirm.btn.cancel'),
      type: 'info',
      ...options,
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
