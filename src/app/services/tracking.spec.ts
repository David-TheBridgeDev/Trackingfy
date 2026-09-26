import { TestBed } from '@angular/core/testing';
import { TrackingService } from './tracking';
import { DatabaseService } from './database';
import { TranslationService } from './translation';
import { TrackingNotificationService } from './tracking-notification';
import { ActivityTypeService } from './activity-types';

describe('TrackingService', () => {
  let service: TrackingService;
  let ts: TranslationService;

  // The real service is a no-op off native, so the notification is only observable in tests
  // through a stand-in that reports itself as available.
  let notificationUpdates: any[];
  let actionHandler: ((action: any) => void) | null;
  /** Every activity handed to the database, so a recording's stored shape is testable. */
  let savedActivities: any[];
  let savedCoordinates: any[];
  let activityUpdates: any[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TrackingService,
        {
          provide: TrackingNotificationService,
          useValue: {
            available: true,
            update: (content: any) => {
              notificationUpdates.push(content);
              return Promise.resolve();
            },
            ensurePermission: () => Promise.resolve(),
            onAction: (handler: any) => {
              actionHandler = handler;
              return Promise.resolve();
            },
          },
        },
        {
          provide: DatabaseService,
          useValue: {
            addActivity: (activity: any) => {
              savedActivities.push(activity);
              return Promise.resolve(1);
            },
            addCoordinate: (coordinate: any) => {
              savedCoordinates.push(coordinate);
              return Promise.resolve(1);
            },
            updateActivity: (_id: number, changes: any) => {
              activityUpdates.push(changes);
              return Promise.resolve(1);
            },
          },
        },
      ],
    });
    notificationUpdates = [];
    actionHandler = null;
    savedActivities = [];
    savedCoordinates = [];
    activityUpdates = [];
    localStorage.clear();
    service = TestBed.inject(TrackingService);
    ts = TestBed.inject(TranslationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /** A fix `meters` north of a fixed origin, `seconds` into the recording. */
  function fix(
    meters: number,
    seconds: number,
    extra: Partial<GeolocationCoordinates> = {},
  ): GeolocationPosition {
    return {
      coords: {
        latitude: 40 + meters / 111_195,
        longitude: -3.7,
        altitude: 650,
        speed: 2,
        accuracy: 5,
        altitudeAccuracy: 6,
        heading: 0,
        ...extra,
      },
      timestamp: 1_700_000_000_000 + seconds * 1000,
    } as GeolocationPosition;
  }

  function startRecordingInPlace() {
    // Bypasses startGeolocation, which has no GPS to talk to in the test environment.
    service.state.set('tracking');
    (service as any).currentActivityId = 1;
  }

  it('stores what the receiver said about each fix, and leaves out the fixes it refuses', () => {
    startRecordingInPlace();

    (service as any).handlePosition(fix(0, 0));
    (service as any).handlePosition(fix(2, 1, { accuracy: 80 }));
    (service as any).handlePosition(fix(4, 2));

    expect(savedCoordinates).toHaveLength(2);
    expect(savedCoordinates[1]).toEqual(
      expect.objectContaining({ accuracy: 5, altitudeAccuracy: 6, speed: 2, segment: 0 }),
    );
  });

  it('measures nothing across a pause', () => {
    startRecordingInPlace();
    for (let s = 0; s <= 10; s++) (service as any).handlePosition(fix(s * 2, s));

    service.pauseTracking();
    // Driven a kilometer while paused: shown on the map, never measured.
    (service as any).handlePosition(fix(1000, 300));
    expect(service.lastCoordinate()?.lat).toBeCloseTo(40 + 1000 / 111_195, 6);
    service.resumeTracking();

    for (let s = 0; s <= 10; s++) (service as any).handlePosition(fix(1000 + s * 2, 600 + s));

    expect(service.currentDistance()).toBeLessThan(45);
    expect(savedCoordinates.at(-1).segment).toBe(1);
  });

  it('saves the recording from the same numbers it showed', async () => {
    startRecordingInPlace();
    for (let s = 0; s <= 60; s++) (service as any).handlePosition(fix(s * 2, s));
    (service as any).accumulatedTime = 61;

    await service.stopTracking();

    const saved = activityUpdates.at(-1);
    expect(saved.totalDistance).toBeCloseTo(120, 0);
    expect(saved.movingTime).toBeLessThanOrEqual(saved.totalTime);
    expect(saved.avgSpeed).toBeCloseTo(saved.totalDistance / saved.movingTime, 6);
  });

  it('leaves the map alone while the app is in the background, and catches it up after', () => {
    const setVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    };

    try {
      startRecordingInPlace();
      setVisibility('hidden');
      for (let s = 0; s <= 20; s++) (service as any).handlePosition(fix(s * 2, s));

      // Measured and stored all along, but nothing drawn.
      expect(service.currentDistance()).toBeGreaterThan(35);
      expect(savedCoordinates).toHaveLength(21);
      expect(service.currentCoordinates()).toHaveLength(0);

      setVisibility('visible');
      expect(service.currentCoordinates()).toHaveLength(21);
      expect(service.lastCoordinate()?.lat).toBeCloseTo(40 + 40 / 111_195, 6);
    } finally {
      delete (document as any).visibilityState;
    }
  });

  it('should filter out altitude changes when there is no horizontal movement', async () => {
    // Manually set state to bypass startGeolocation geolocation failures in test environment
    service.state.set('tracking');
    (service as any).currentActivityId = 1;

    // Simulate first point: Madrid (lat: 40.4168, lng: -3.7038) at 100m altitude
    const pos1 = {
      coords: {
        latitude: 40.4168,
        longitude: -3.7038,
        altitude: 100,
        speed: 1,
        accuracy: 5,
        altitudeAccuracy: 5,
        heading: 0,
      },
      timestamp: Date.now(),
    } as GeolocationPosition;

    (service as any).handlePosition(pos1);

    // Simulate second point with no horizontal movement but a 5m change in altitude (should be filtered out)
    const pos2 = {
      coords: {
        latitude: 40.4168,
        longitude: -3.7038,
        altitude: 105,
        speed: 1,
        accuracy: 5,
        altitudeAccuracy: 5,
        heading: 0,
      },
      timestamp: Date.now() + 1000,
    } as GeolocationPosition;

    (service as any).handlePosition(pos2);

    expect(service.currentClimb()).toBe(0);
    expect(service.currentDescent()).toBe(0);
  });

  it('should filter out minor altitude changes (noise) and accumulate real climb correctly', async () => {
    startRecordingInPlace();

    // A minute on the flat with the altitude wobbling a meter either side: no climb.
    for (let s = 0; s < 60; s++) {
      (service as any).handlePosition(
        fix(s * 3, s, { speed: 3, altitude: 100 + (s % 2 ? 1 : -1) }),
      );
    }
    expect(service.currentClimb()).toBe(0);

    // Then five minutes up a 10% ramp: 90 m of real climbing.
    for (let s = 60; s < 360; s++) {
      const along = s * 3;
      (service as any).handlePosition(
        fix(along, s, { speed: 3, altitude: 100 + (along - 180) * 0.1 }),
      );
    }

    expect(service.currentClimb()).toBeGreaterThan(80);
    expect(service.currentClimb()).toBeLessThanOrEqual(90);
    expect(service.currentDescent()).toBe(0);
  });

  it('rounds the notification distance to 100 m so a fast descent does not repost per second', () => {
    service.state.set('tracking');
    service.currentDistance.set(1234);
    service.currentClimb.set(47);

    (service as any).syncNotification(true);

    const last = notificationUpdates.at(-1);
    expect(last.chipText).toBe('1.2 km');
    expect(last.text).toBe(ts.t('tracking.notif_stats', { distance: '1.2', climb: '50' }));
  });

  it('does not repost while the displayed values are unchanged', () => {
    service.state.set('tracking');
    service.currentDistance.set(1234);

    (service as any).syncNotification(true);
    const posted = notificationUpdates.length;

    // Two metres further on: a new fix, but nothing the notification would render.
    service.currentDistance.set(1236);
    (service as any).syncNotification();

    expect(notificationUpdates.length).toBe(posted);
  });

  it('stops the chronometer and shows the frozen time while paused', () => {
    service.state.set('tracking');
    // Pausing recomputes the elapsed time from the timer's own bookkeeping, so seed that
    // rather than the signal it derives.
    (service as any).accumulatedTime = 3661;

    service.pauseTracking();

    const last = notificationUpdates.at(-1);
    expect(last.title).toBe(ts.t('tracking.notif_paused_title'));
    expect(last.ongoingSince).toBeUndefined();
    expect(last.text).toContain('01:01:01');
  });

  it('files the recording as the activity the dashboard is set to', async () => {
    // Before the selector existed this was hard-coded to cycling, which left the
    // history's type filter and the statistics' per-activity split with one row.
    TestBed.inject(ActivityTypeService).select('Running');

    await service.startTracking();

    expect(savedActivities.at(-1).type).toBe('Running');
  });

  it('applies the notification buttons to the recording', async () => {
    service.state.set('tracking');
    (service as any).currentActivityId = 1;

    actionHandler!('pause');
    expect(service.state()).toBe('paused');

    actionHandler!('resume');
    expect(service.state()).toBe('tracking');

    actionHandler!('finish');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.state()).toBe('idle');
  });
});
