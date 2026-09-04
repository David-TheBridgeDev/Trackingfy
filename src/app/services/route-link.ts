import { inject, Injectable, NgZone, signal } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { DatabaseService, ImportResult } from './database';

/** What became of a file that another app handed to Trackingfy. */
export type RouteLinkResult = ImportResult | { kind: 'invalid' };

interface RouteImportPlugin {
  /** The route waiting from the intent that launched the app, if there was one. */
  consumePendingRoute(): Promise<{ data?: string }>;
  addListener(
    eventName: 'routeReceived',
    listener: (payload: { data: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const PLUGIN_NAME = 'RouteImport';
const RouteImport = registerPlugin<RouteImportPlugin>(PLUGIN_NAME);

/**
 * Imports a route that arrived from outside the app.
 *
 * Without this, receiving a shared route means saving the file, opening Trackingfy, going
 * to Settings and hunting the file down. With it, opening the file or sharing it to
 * Trackingfy is the whole gesture: the native side reads the file and this turns it into
 * an activity through the same importer the Settings screen uses.
 */
@Injectable({
  providedIn: 'root',
})
export class RouteLinkService {
  private db = inject(DatabaseService);
  private ngZone = inject(NgZone);

  /**
   * The last file that arrived. A fresh object every time, so two identical outcomes in a
   * row still reach whoever is watching.
   */
  received = signal<RouteLinkResult | null>(null);

  /**
   * Begin accepting routes from other apps.
   *
   * Does nothing on the web, and nothing on an install whose APK predates the native half
   * of this feature: the web layer is served remotely and updates on its own, so it will
   * regularly run against an older shell than it expects.
   */
  async start(): Promise<void> {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable(PLUGIN_NAME)) {
      return;
    }

    try {
      await RouteImport.addListener('routeReceived', (payload) => {
        // Plugin callbacks arrive from outside Angular's zone.
        this.ngZone.run(() => void this.handle(payload?.data));
      });

      // A file that launched the app was read before anything here was listening.
      const pending = await RouteImport.consumePendingRoute();
      if (pending?.data) {
        await this.ngZone.run(() => this.handle(pending.data));
      }
    } catch (e) {
      console.error('Could not set up route sharing:', e);
    }
  }

  private async handle(json: string | undefined): Promise<void> {
    if (!json) return;

    try {
      this.received.set({ ...(await this.db.importData(json)) });
    } catch (e) {
      // Anything can be shared to an app that accepts JSON, so a file that is not ours is
      // an ordinary outcome rather than a failure worth logging loudly.
      console.warn('Shared file was not a Trackingfy route:', e);
      this.received.set({ kind: 'invalid' });
    }
  }
}
