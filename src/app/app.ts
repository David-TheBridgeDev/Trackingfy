import { Component, signal, HostListener } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { UIService } from './services/ui';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  constructor(public uiService: UIService) {}

  protected readonly title = signal('trackingfy');
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
