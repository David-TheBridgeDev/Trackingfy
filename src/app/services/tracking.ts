import { Injectable, signal, NgZone } from '@angular/core';
import { DatabaseService, Activity, Coordinate, Split } from './database';
import { TranslationService } from './translation';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { BackgroundGeolocationPlugin } from '@capgo/background-geolocation';
import {
  TrackingNotificationService,
  type TrackingNotificationAction,
} from './tracking-notification';
import { ActivityTypeService } from './activity-types';
import { ActivityMetrics } from './activity-metrics';
import { AltimeterService } from './altimeter';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export type TrackingState = 'idle' | 'tracking' | 'paused';

// A permission probe that never gets a fix still holds a foreground service, and with it a
// notification, so it is bounded. Recentering the map is the retry, and starting a recording
// opens its own session regardless of how the probe ended.
const PERMISSION_PROBE_TIMEOUT_MS = 20000;

// Matches how the dashboard renders the same value, so the notification and the screen it
// mirrors never disagree about the elapsed time.
function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => (v < 10 ? '0' + v : v)).join(':');
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && isFinite(value) ? value : null;
}

@Injectable({
  providedIn: 'root',
})
export class TrackingService {
  private watchId: number | string | null = null;
  private currentActivityId: number | null = null;
  private startTimeSegment: number | null = null;
  /**
   * Seconds recorded in the segments a pause has already closed. Fractional: rounding
   * each segment down lost up to a second per pause.
   */
  private accumulatedTime: number = 0;

  state = signal<TrackingState>('idle');
  currentDistance = signal(0); // in meters
  currentTime = signal(0); // in seconds
  currentSpeed = signal(0); // in m/s
  currentClimb = signal(0); // in meters
  currentDescent = signal(0); // in meters
  currentAltitude = signal<number | null>(null);
  lastCoordinate = signal<Coordinate | null>(null);
  currentCoordinates = signal<Coordinate[]>([]);

  // Reference route
  referenceCoordinates = signal<Coordinate[]>([]);
  referenceActivityId = signal<number | null>(null);

  // New metrics
  currentPace = signal(0); // in minutes per km
  avgPace = signal(0); // in minutes per km
  maxSpeed = signal(0); // in m/s
  movingTime = signal(0); // in seconds
  currentGrade = signal(0); // percentage (-100 to +100)
  maxGrade = signal(0); // in % (highest climb)
  minGrade = signal(0); // in % (steepest descent)
  splits = signal<Split[]>([]);

  /** Every number above is read from here; see activity-metrics.ts. */
  private metrics = new ActivityMetrics();
  /** Increments on every resume, so the stored track remembers where the pauses were. */
  private segment = 0;
  /** The recording's stored fixes, published to the map only while someone can see it. */
  private track: Coordinate[] = [];
  /** The latest position, and whether the map is behind on it because the page is hidden. */
  private viewPoint: Coordinate | null = null;
  private viewBehind = false;
  private pageVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';

  isTracking = signal(false); // Legacy support for simple checks
  permissionDenied = signal(false);

  private timerInterval: any;
  private permissionProbe: { done: Promise<boolean>; cancel: () => void } | null = null;
  private lastNotificationKey: string | null = null;

  constructor(
    private db: DatabaseService,
    private ngZone: NgZone,
    private ts: TranslationService,
    private notification: TrackingNotificationService,
    private activityTypes: ActivityTypeService,
    private altimeter: AltimeterService,
  ) {
    void this.notification.onAction((action) => this.applyNotificationAction(action));

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.pageVisible = document.visibilityState !== 'hidden';
        if (this.pageVisible && this.viewBehind) this.ngZone.run(() => this.publishView());
      });
    }
  }

  async requestPermission(): Promise<boolean> {
    // The startup probe and the map's recenter retry can both land here at once, and the
    // native plugin rejects a second session with ALREADY_STARTED. One probe at a time.
    if (this.permissionProbe) return this.permissionProbe.done;

    if (Capacitor.isNativePlatform()) {
      return this.probeNativeLocation();
    }

    return this.probeBrowserLocation();
  }

  // Asking natively means running a real BackgroundGeolocation session, which means a real
  // foreground service notification. So every exit path stops it before the caller hears
  // back, and the probe is cancellable for when the user starts recording mid-probe.
  private probeNativeLocation(): Promise<boolean> {
    let settle: ((granted: boolean) => void) | null = null;
    let timeout: any;

    const finish = async (granted: boolean) => {
      if (!settle) return;
      const resolve = settle;
      settle = null;
      clearTimeout(timeout);
      try {
        await BackgroundGeolocation.stop();
      } catch {
        // Nothing was running, which is the state we were trying to reach anyway.
      }
      this.permissionProbe = null;
      resolve(granted);
    };

    const fail = (e: unknown) => {
      console.error('Error probing location permission:', e);
      this.ngZone.run(() => {
        this.permissionDenied.set(true);
      });
      void finish(false);
    };

    const done = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    this.permissionProbe = { done, cancel: () => void finish(false) };
    timeout = setTimeout(() => void finish(false), PERMISSION_PROBE_TIMEOUT_MS);

    try {
      BackgroundGeolocation.start(
        {
          backgroundTitle: this.ts.t('tracking.permission_title'),
          backgroundMessage: this.ts.t('tracking.permission_message'),
          requestPermissions: true,
          stale: true,
        },
        (location, error) => {
          if (error) {
            fail(error);
            return;
          }

          if (location) {
            this.ngZone.run(() => {
              this.permissionDenied.set(false);
              this.lastCoordinate.set({
                activityId: 0,
                lat: location.latitude,
                lng: location.longitude,
                timestamp: location.time || Date.now(),
                altitude: location.altitude ?? null,
                speed: location.speed ?? null,
              });
              this.currentAltitude.set(location.altitude ?? null);
            });
            void finish(true);
          }
        },
      ).catch(fail);
    } catch (e) {
      fail(e);
    }

    return done;
  }

  private probeBrowserLocation(): Promise<boolean> {
    if (!('geolocation' in navigator)) {
      console.error('Geolocation not supported');
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.ngZone.run(() => {
            this.permissionDenied.set(false);
            const { latitude, longitude, altitude, speed } = position.coords;
            const { timestamp } = position;
            this.lastCoordinate.set({
              activityId: 0,
              lat: latitude,
              lng: longitude,
              timestamp,
              altitude: altitude ?? null,
              speed: speed ?? null,
            });
            this.currentAltitude.set(altitude ?? null);
          });
          resolve(true);
        },
        (error) => {
          console.error('Geolocation error:', error);
          this.ngZone.run(() => {
            if (error.code === error.PERMISSION_DENIED) {
              this.permissionDenied.set(true);
            }
          });
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    });
  }

  async startTracking() {
    if (this.state() !== 'idle') return;

    // The startup probe holds a BackgroundGeolocation session of its own, and the plugin
    // would reject the recording session with ALREADY_STARTED while it is still up.
    const probe = this.permissionProbe;
    if (probe) {
      probe.cancel();
      await probe.done;
      if (this.state() !== 'idle') return;
    }

    const activity: Activity = {
      date: new Date(),
      // What the dashboard's selector is on. Until it existed every route was filed as
      // cycling, which left the history's type filter and the statistics' breakdown with
      // a single row to show.
      type: this.activityTypes.current(),
      totalDistance: 0,
      totalTime: 0,
      avgSpeed: 0,
      totalClimb: 0,
      totalDescent: 0,
      startTime: Date.now(),
    };

    this.currentActivityId = await this.db.addActivity(activity);
    this.state.set('tracking');
    this.isTracking.set(true);
    this.resetRecording();
    this.lastCoordinate.set(null);

    // Not awaited: the barometer starts in the time the first fix takes to arrive, and
    // until it does the fixes simply carry no pressure.
    void this.altimeter.beginRecording();
    this.startTimer();
    await this.startGeolocation();
    this.syncNotification(true);

    // Asked here rather than at start-up: the notification only becomes true once something
    // is being recorded, and by this point the location dialog has already been settled, so
    // the two never stack. Deliberately not awaited - a recording does not wait on a dialog.
    void this.notification.ensurePermission().then(() => this.syncNotification(true));
  }

  pauseTracking() {
    if (this.state() !== 'tracking') return;
    this.state.set('paused');
    this.stopTimer();
    this.currentSpeed.set(0);
    this.syncNotification(true);
  }

  resumeTracking() {
    if (this.state() !== 'paused') return;
    // Whatever happened while paused, nothing is measured across it.
    this.segment++;
    this.state.set('tracking');
    this.startTimer();
    this.syncNotification(true);
  }

  loadReferenceRoute(coords: Coordinate[], activityId: number) {
    this.referenceCoordinates.set(coords);
    this.referenceActivityId.set(activityId);
  }

  clearReferenceRoute() {
    this.referenceCoordinates.set([]);
    this.referenceActivityId.set(null);
  }

  private applyNotificationAction(action: TrackingNotificationAction) {
    if (action === 'pause') {
      this.pauseTracking();
    } else if (action === 'resume') {
      this.resumeTracking();
    } else {
      void this.stopTracking();
    }
  }

  /**
   * Redraw the recording notification, but only when what it says would actually change.
   *
   * The elapsed time ticks in the system UI on its own from a fixed start instant, so the
   * only live value left is the distance - and only at the resolution the notification
   * shows. Bucketing on the rendered strings is what stops a fast descent from reposting
   * several times a second for digits nobody can read.
   */
  private syncNotification(force = false) {
    if (!this.notification.available) return;

    const state = this.state();
    if (state === 'idle') {
      this.lastNotificationKey = null;
      return;
    }

    const paused = state === 'paused';
    const elapsed = this.currentTime();
    const distance = (Math.round(this.currentDistance() / 100) / 10).toFixed(1);
    const climb = String(Math.round(this.currentClimb() / 10) * 10);

    const key = `${state}|${distance}|${climb}|${paused ? elapsed : ''}`;
    if (!force && key === this.lastNotificationKey) return;
    this.lastNotificationKey = key;

    // Derived from the timer's own bookkeeping rather than from the clock, so repeated
    // reposts within a segment hand the system the same instant and the seconds do not
    // jitter. A paused session sends none at all and carries its frozen time in the text.
    const chronometerBase =
      !paused && this.startTimeSegment !== null
        ? Math.round(this.startTimeSegment - this.accumulatedTime * 1000)
        : undefined;

    void this.notification.update({
      title: paused ? this.ts.t('tracking.notif_paused_title') : this.ts.t('tracking.bg_title'),
      text: paused
        ? this.ts.t('tracking.notif_stats_paused', {
            distance,
            climb,
            time: formatElapsed(elapsed),
          })
        : this.ts.t('tracking.notif_stats', { distance, climb }),
      chipText: `${distance} km`,
      ongoingSince: chronometerBase,
      promoted: true,
      actions: [
        paused
          ? { id: 'resume', title: this.ts.t('tracking.notif_action_resume') }
          : { id: 'pause', title: this.ts.t('tracking.notif_action_pause') },
        { id: 'finish', title: this.ts.t('tracking.notif_action_finish') },
      ],
    });
  }

  private updateCurrentTime() {
    const running =
      this.state() === 'tracking' && this.startTimeSegment !== null
        ? (Date.now() - this.startTimeSegment) / 1000
        : 0;
    this.currentTime.set(Math.floor(this.accumulatedTime + running));

    // Update avgPace
    const distKm = this.currentDistance() / 1000;
    if (distKm > 0) {
      this.avgPace.set(this.currentTime() / 60 / distKm);
    }
  }

  private startTimer() {
    this.startTimeSegment = Date.now();
    this.updateCurrentTime();
    this.timerInterval = setInterval(() => {
      this.updateCurrentTime();
    }, 1000);
  }

  private stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.startTimeSegment !== null) {
      this.accumulatedTime += (Date.now() - this.startTimeSegment) / 1000;
      this.startTimeSegment = null;
    }
    this.updateCurrentTime();
  }

  private async startGeolocation() {
    if (Capacitor.isNativePlatform()) {
      try {
        await BackgroundGeolocation.start(
          {
            backgroundMessage: this.ts.t('tracking.bg_message'),
            backgroundTitle: this.ts.t('tracking.bg_title'),
            requestPermissions: true,
            stale: false,
            distanceFilter: 2,
          },
          (location) => {
            if (location) {
              // Map Capgo location to standard GeolocationPosition-like object
              const position = {
                coords: {
                  latitude: location.latitude,
                  longitude: location.longitude,
                  altitude: location.altitude,
                  speed: location.speed,
                  accuracy: location.accuracy,
                  altitudeAccuracy: location.altitudeAccuracy,
                  heading: 0, // Default heading
                },
                timestamp: location.time || Date.now(),
              } as GeolocationPosition;
              this.handlePosition(position);
            }
          },
        );
        this.watchId = 'native';
      } catch (e) {
        console.error('Error starting background geolocation:', e);
        this.stopTracking();
      }
    } else if ('geolocation' in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.handlePosition(position),
        (error) => console.error('Geolocation error:', error),
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0,
        },
      );
    } else {
      console.error('Geolocation not supported');
      this.stopTracking();
    }
  }

  private handlePosition(position: GeolocationPosition) {
    this.ngZone.run(() => {
      const { latitude, longitude, altitude, speed, accuracy, altitudeAccuracy } = position.coords;

      if (this.state() !== 'tracking') {
        // Paused: the map keeps following, but nothing is measured or stored.
        this.showPosition({
          activityId: this.currentActivityId || 0,
          lat: latitude,
          lng: longitude,
          timestamp: position.timestamp,
          altitude: finiteOrNull(altitude),
          speed: finiteOrNull(speed),
        });
        return;
      }

      const coord: Coordinate = {
        activityId: this.currentActivityId || 0,
        lat: latitude,
        lng: longitude,
        timestamp: position.timestamp,
        altitude: this.altimeter.toSeaLevel(latitude, longitude, altitude),
        speed: finiteOrNull(speed),
        accuracy: finiteOrNull(accuracy),
        altitudeAccuracy: finiteOrNull(altitudeAccuracy),
        pressure: this.altimeter.currentPressure(),
        segment: this.segment,
      };

      // A fix the metrics refuse (too inaccurate, a jump, a repeat) is not part of the
      // route: storing it would draw it and bring it back on any recomputation.
      if (this.metrics.push(coord) !== 'accepted') return;

      this.db.addCoordinate(coord);
      this.track.push(coord);
      this.publishMetrics();
      this.showPosition(coord);
      this.updateCurrentTime();
      this.syncNotification();
    });
  }

  private publishMetrics() {
    const metrics = this.metrics;

    this.currentDistance.set(metrics.distance);
    this.movingTime.set(metrics.movingTime);
    this.currentSpeed.set(metrics.speed);
    this.currentPace.set(metrics.speed > 0 ? 1000 / metrics.speed / 60 : 0);
    this.maxSpeed.set(metrics.maxSpeed);
    this.currentClimb.set(metrics.climb);
    this.currentDescent.set(metrics.descent);
    this.currentGrade.set(metrics.grade);
    this.maxGrade.set(metrics.maxGrade);
    this.minGrade.set(metrics.minGrade);
    this.currentAltitude.set(metrics.altitude);
    if (metrics.splits.length !== this.splits().length) this.splits.set([...metrics.splits]);
  }

  /**
   * Move the map to a new position, unless nobody can see it.
   *
   * With the screen off or the app in the background, redrawing a route of thousands of
   * points and panning the map (which fetches tiles) on every fix only drains the battery.
   * The recording itself does not depend on any of it, so the view catches up in one go
   * when the page is visible again.
   */
  private showPosition(coord: Coordinate) {
    this.viewPoint = coord;
    if (this.pageVisible) {
      this.publishView();
    } else {
      this.viewBehind = true;
    }
  }

  private publishView() {
    this.viewBehind = false;
    if (this.viewPoint) this.lastCoordinate.set(this.viewPoint);
    if (this.currentCoordinates().length !== this.track.length) {
      this.currentCoordinates.set(this.track.slice());
    }
  }

  /** Clear everything measured, for a recording that starts or one that has ended. */
  private resetRecording() {
    this.metrics = new ActivityMetrics();
    this.segment = 0;
    this.track = [];
    this.viewPoint = null;
    this.viewBehind = false;
    this.accumulatedTime = 0;
    this.startTimeSegment = null;

    this.currentTime.set(0);
    this.currentDistance.set(0);
    this.currentSpeed.set(0);
    this.currentClimb.set(0);
    this.currentDescent.set(0);
    this.currentAltitude.set(null);
    this.currentCoordinates.set([]);
    this.currentPace.set(0);
    this.avgPace.set(0);
    this.maxSpeed.set(0);
    this.movingTime.set(0);
    this.currentGrade.set(0);
    this.maxGrade.set(0);
    this.minGrade.set(0);
    this.splits.set([]);
  }

  async stopTracking() {
    if (this.state() === 'idle') return;

    if (this.watchId !== null) {
      if (Capacitor.isNativePlatform()) {
        await BackgroundGeolocation.stop();
      } else {
        navigator.geolocation.clearWatch(this.watchId as number);
      }
      this.watchId = null;
    }
    void this.altimeter.endRecording();

    this.stopTimer();

    const metrics = this.metrics;
    metrics.finish();
    const totalDistance = metrics.distance;
    const totalTime = this.currentTime();
    // Moving time runs on the fixes' clock and the duration on the phone's; the first can
    // never honestly exceed the second.
    const movingTime = Math.min(Math.round(metrics.movingTime), totalTime);
    const avgSpeed = movingTime > 0 ? totalDistance / movingTime : 0;

    if (this.currentActivityId) {
      await this.db.updateActivity(this.currentActivityId, {
        totalDistance,
        totalTime,
        movingTime,
        avgSpeed,
        maxSpeed: metrics.maxSpeed,
        maxGrade: metrics.maxGrade,
        minGrade: metrics.minGrade,
        totalClimb: metrics.climb,
        totalDescent: metrics.descent,
        endTime: Date.now(),
        splits: [...metrics.splits],
      });
    }

    this.state.set('idle');
    this.isTracking.set(false);
    this.currentActivityId = null;
    this.resetRecording();
    this.lastNotificationKey = null;
    this.clearReferenceRoute();
  }
}
