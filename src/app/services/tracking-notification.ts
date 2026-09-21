import { Injectable, NgZone, inject } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PermissionState, PluginListenerHandle } from '@capacitor/core';

export type TrackingNotificationAction = 'pause' | 'resume' | 'finish';

export interface TrackingNotificationContent {
  title: string;
  text: string;
  /** Shown in the Android 16 status bar chip, so it has room for a few characters at most. */
  chipText?: string;
  /** Epoch milliseconds the system counts up from. Omit to leave the clock frozen. */
  ongoingSince?: number;
  promoted?: boolean;
  actions?: { id: TrackingNotificationAction; title: string }[];
}

interface TrackingNotificationPlugin {
  update(content: TrackingNotificationContent): Promise<void>;
  checkPermissions(): Promise<{ notifications: PermissionState }>;
  requestPermissions(): Promise<{ notifications: PermissionState }>;
  addListener(
    eventName: 'trackingAction',
    listenerFunc: (event: { action: TrackingNotificationAction }) => void,
  ): Promise<PluginListenerHandle>;
}

const TrackingNotification = registerPlugin<TrackingNotificationPlugin>('TrackingNotification');

/**
 * The recording notification: live distance, elapsed time and the pause and finish buttons.
 *
 * Android only. On the web the recording lives in a tab the user is already looking at, and
 * there is no equivalent surface worth faking, so every method here is a no-op off native.
 */
@Injectable({
  providedIn: 'root',
})
export class TrackingNotificationService {
  private ngZone = inject(NgZone);
  private listening = false;

  readonly available = Capacitor.isNativePlatform();

  async update(content: TrackingNotificationContent): Promise<void> {
    if (!this.available) return;

    try {
      await TrackingNotification.update(content);
    } catch (e) {
      // A notification that fails to draw is not a reason to interrupt a recording.
      console.error('Could not update the recording notification:', e);
    }
  }

  /**
   * Android 13+ needs POST_NOTIFICATIONS before anything can be drawn, and the background
   * geolocation plugin only asks for it as a side effect of its location dialog. A user who
   * had already granted location - or who declined notifications once - is therefore never
   * asked again, and records with nothing on screen at all. Asking as a recording starts is
   * both the moment it becomes true and the one the user can make sense of.
   */
  async ensurePermission(): Promise<void> {
    if (!this.available) return;

    try {
      const status = await TrackingNotification.checkPermissions();
      if (status.notifications !== 'granted') {
        await TrackingNotification.requestPermissions();
      }
    } catch (e) {
      console.error('Could not resolve the notification permission:', e);
    }
  }

  /** Registers once; later calls are ignored so a re-entrant caller cannot stack listeners. */
  async onAction(handler: (action: TrackingNotificationAction) => void): Promise<void> {
    if (!this.available || this.listening) return;
    this.listening = true;

    try {
      await TrackingNotification.addListener('trackingAction', (event) => {
        // The tap arrives from a broadcast receiver, well outside Angular's zone.
        this.ngZone.run(() => handler(event.action));
      });
    } catch (e) {
      this.listening = false;
      console.error('Could not listen for notification actions:', e);
    }
  }
}
