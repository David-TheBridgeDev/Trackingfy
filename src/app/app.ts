import { Component, effect, signal, untracked, HostListener, inject, NgZone } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { UIService } from './services/ui';
import { TrackingService } from './services/tracking';
import { TranslationService } from './services/translation';
import { RouteLinkService, RouteLinkResult } from './services/route-link';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private router = inject(Router);
  public location = inject(Location);
  public uiService = inject(UIService);
  public trackingService = inject(TrackingService);
  public ts = inject(TranslationService);
  private ngZone = inject(NgZone);
  private routeLink = inject(RouteLinkService);

  // Tracks if we are on the dashboard
  isHomePage = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.router.url === '/' || this.router.url === '/dashboard')
    ),
    { initialValue: true }
  );

  // Tracks if we are on the history or activity details page
  isHistoryPage = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.router.url === '/history' || this.router.url.startsWith('/activity/'))
    ),
    { initialValue: false }
  );

  // Tracks if we are on the statistics page
  isStatsPage = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.router.url === '/stats')
    ),
    { initialValue: false }
  );

  // Tracks if we are on the settings page
  isSettingsPage = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.router.url === '/settings')
    ),
    { initialValue: false }
  );

  private lastBackPress = 0;

  onMainScroll(event: Event) {
    const target = event.target as HTMLElement;
    if (this.router.url === '/history' && target) {
      this.uiService.historyScrollTop = target.scrollTop;
    }
  }

  /** Kept as the components' way in; the message itself now lives in the UI service. */
  public triggerToast(message: string) {
    this.uiService.showToast(message);
  }

  constructor() {
    // Request permissions immediately on startup
    this.trackingService.requestPermission();
    this.setupBackButton();
    this.setupRouteSharing();
    this.setupPromptFocus();
  }

  /**
   * Put the caret in the prompt's field as soon as it opens.
   *
   * Every prompt exists to take a name, so the keyboard should already be up when it
   * appears rather than after one more tap.
   */
  private setupPromptFocus() {
    effect(() => {
      if (!this.uiService.promptRequest()) return;

      requestAnimationFrame(() => {
        const input = document.getElementById('prompt-input') as HTMLInputElement | null;
        input?.focus();
        input?.select();
      });
    });
  }

  private setupRouteSharing() {
    effect(() => {
      const result = this.routeLink.received();
      if (!result) return;

      // Everything the announcement reads is deliberately untracked: it consults the
      // tracking state, and this effect must fire when a route arrives, not every time
      // the user starts or stops recording.
      untracked(() => this.announceSharedRoute(result));
    });

    void this.routeLink.start();
  }

  private announceSharedRoute(result: RouteLinkResult) {
    if (result.kind === 'invalid') {
      this.triggerToast(this.ts.t('settings.backup.route_invalid'));
      return;
    }

    if (result.kind === 'backup') {
      this.triggerToast(this.ts.t('settings.backup.success'));
      return;
    }

    this.triggerToast(
      this.ts.t(
        result.imported ? 'settings.backup.route_imported' : 'settings.backup.route_duplicate'
      )
    );

    // Opening the route is the obvious next step, but not in the middle of an activity:
    // pulling the screen out from under someone who is recording is worse than a toast.
    if (result.activityId && this.trackingService.state() === 'idle') {
      this.router.navigate(['/activity', result.activityId]);
    }
  }

  private setupBackButton() {
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('backButton', () => {
        this.ngZone.run(() => {
          if (this.uiService.promptRequest()) {
            this.uiService.resolvePrompt(null);
          } else if (this.uiService.confirmation()) {
            this.uiService.resolveConfirm(false);
          } else if (this.uiService.showOnboarding()) {
            CapApp.exitApp();
          } else if (this.router.url === '/' || this.router.url === '/dashboard') {
            const now = Date.now();
            if (now - this.lastBackPress < 2000) {
              CapApp.exitApp();
            } else {
              this.lastBackPress = now;
              this.triggerToast(this.ts.t('app.toast_exit'));
            }
          } else {
            this.location.back();
          }
        });
      });
    }
  }

  protected readonly title = signal('trackingfy');

  async handleStart() {
    this.uiService.completeOnboarding();
  }

  isOnline = signal(navigator.onLine);

  @HostListener('window:online')
  onOnline() {
    this.isOnline.set(true);
  }

  @HostListener('window:offline')
  onOffline() {
    this.isOnline.set(false);
  }
}
