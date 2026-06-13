import { Component, signal, HostListener, inject, NgZone } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { UIService } from './services/ui';
import { TrackingService } from './services/tracking';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private router = inject(Router);
  public location = inject(Location);
  public uiService = inject(UIService);
  public trackingService = inject(TrackingService);
  private ngZone = inject(NgZone);

  // Tracks if we are on the dashboard
  isHomePage = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.router.url === '/' || this.router.url === '/dashboard')
    ),
    { initialValue: true }
  );

  // Tracks if we are on the dashboard or activity detail page
  isActivityOrDetail = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.router.url === '/' || this.router.url === '/dashboard' || this.router.url.startsWith('/activity/'))
    ),
    { initialValue: true }
  );

  showToast = signal(false);
  toastMessage = signal('');
  private lastBackPress = 0;
  private toastTimeout: any;

  private triggerToast(message: string) {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    this.toastMessage.set(message);
    this.showToast.set(true);
    this.toastTimeout = setTimeout(() => {
      this.showToast.set(false);
    }, 2000);
  }

  constructor() {
    // Request permissions immediately on startup
    this.trackingService.requestPermission();
    this.setupBackButton();
  }

  private setupBackButton() {
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('backButton', () => {
        this.ngZone.run(() => {
          if (this.uiService.confirmation()) {
            this.uiService.resolveConfirm(false);
          } else if (this.uiService.showOnboarding()) {
            CapApp.exitApp();
          } else if (this.router.url === '/' || this.router.url === '/dashboard') {
            const now = Date.now();
            if (now - this.lastBackPress < 2000) {
              CapApp.exitApp();
            } else {
              this.lastBackPress = now;
              this.triggerToast('Presiona atrás de nuevo para salir');
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
