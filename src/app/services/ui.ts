import { TranslationService } from './translation';
import { inject, Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'info';
  /** Drops the cancel button, for messages that ask nothing of the user. */
  hideCancel?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  /** What the field starts with, for a rename rather than a first naming. */
  value?: string;
  confirmText?: string;
  cancelText?: string;
  maxLength?: number;
}

/** The single thing a toast can offer to do, such as taking a deletion back. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastMessage {
  text: string;
  action?: ToastAction;
}

/** Long enough to read and reach for, short enough not to sit over the list. */
const TOAST_MS = 2000;
const TOAST_WITH_ACTION_MS = 6000;

@Injectable({
  providedIn: 'root',
})
export class UIService {
  private ts = inject(TranslationService);
  isFullScreen = signal<boolean>(false);
  showOnboarding = signal<boolean>(false);
  currentTheme = signal<Theme>('light');
  historyScrollTop = 0;

  private confirmResolver?: (value: boolean) => void;
  confirmation = signal<ConfirmOptions | null>(null);

  private promptResolver?: (value: string | null) => void;
  promptRequest = signal<PromptOptions | null>(null);
  /** What the open prompt's field currently holds, so the modal stays a dumb view. */
  promptValue = signal('');

  toast = signal<ToastMessage | null>(null);
  private toastTimeout?: ReturnType<typeof setTimeout>;

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

  /**
   * Show an explanation with a single acknowledge button.
   *
   * Long help text costs screen space every time a panel is open, so it lives here and
   * appears only when someone taps the information icon that offers it.
   */
  info(options: { title: string; message: string }): Promise<boolean> {
    return this.confirm({
      ...options,
      confirmText: this.ts.t('confirm.btn.got_it'),
      hideCancel: true,
      type: 'info',
    });
  }

  resolveConfirm(result: boolean) {
    this.confirmation.set(null);
    if (this.confirmResolver) {
      this.confirmResolver(result);
      this.confirmResolver = undefined;
    }
  }

  /**
   * Ask for a line of text, the way `confirm` asks for a yes.
   *
   * Naming a route and naming a collection are the same interaction, and both can be
   * reached from more than one screen, so the dialog lives here with the others instead
   * of being rebuilt inside each component that needs a name.
   */
  prompt(options: PromptOptions): Promise<string | null> {
    // A prompt opened while another is waiting would strand its caller's promise.
    this.resolvePrompt(null);

    this.promptValue.set(options.value ?? '');
    this.promptRequest.set({
      confirmText: this.ts.t('confirm.btn.confirm'),
      cancelText: this.ts.t('confirm.btn.cancel'),
      maxLength: 60,
      ...options,
    });

    return new Promise((resolve) => {
      this.promptResolver = resolve;
    });
  }

  /** Close the prompt with the typed value, or with null when it was dismissed. */
  resolvePrompt(value: string | null) {
    if (!this.promptResolver) return;

    const trimmed = value === null ? null : value.trim();
    this.promptRequest.set(null);
    this.promptValue.set('');

    const resolver = this.promptResolver;
    this.promptResolver = undefined;
    resolver(trimmed ? trimmed : null);
  }

  /**
   * Flash a message at the bottom of the screen, optionally with one thing to do.
   *
   * The action is what makes a destructive step safe to take quickly: a deletion that
   * can be undone from the toast needs no second thoughts before it is confirmed.
   */
  showToast(text: string, action?: ToastAction) {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);

    this.toast.set({ text, action });
    this.toastTimeout = setTimeout(
      () => this.toast.set(null),
      action ? TOAST_WITH_ACTION_MS : TOAST_MS,
    );
  }

  dismissToast() {
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toast.set(null);
  }

  runToastAction() {
    const action = this.toast()?.action;
    this.dismissToast();
    action?.run();
  }
}
