import { Component, signal, HostListener, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { UIService } from './services/ui';
import { TrackingService } from './services/tracking';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

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

  // Tracks if we are on the dashboard
  isHomePage = toSignal(
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      map(() => this.router.url === '/' || this.router.url === '/dashboard')
    ),
    { initialValue: true }
  );

  constructor() {
    // If user has already seen onboarding but permissions are missing, try to get them
    if (!this.uiService.showOnboarding()) {
      this.trackingService.requestPermission();
    }
  }

  protected readonly title = signal('trackingfy');

  async handleStart() {
    const success = await this.trackingService.requestPermission();
    if (success) {
      this.uiService.completeOnboarding();
    }
  }

  isOnline = signal(navigator.onLine);
  deferredPrompt = signal<any>(null);

  @HostListener('window:online')
  onOnline() {
    this.isOnline.set(true);
  }

  @HostListener('window:offline')
  onOffline() {
    this.isOnline.set(false);
  }

  @HostListener('window:beforeinstallprompt', ['$event'])
  onBeforeInstallPrompt(e: Event) {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    this.deferredPrompt.set(e);
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
}
