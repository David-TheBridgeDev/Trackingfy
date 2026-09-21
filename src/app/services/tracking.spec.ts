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
            addCoordinate: () => Promise.resolve(1),
            updateActivity: () => Promise.resolve(1),
          },
        },
      ],
    });
    notificationUpdates = [];
    actionHandler = null;
    savedActivities = [];
    localStorage.clear();
    service = TestBed.inject(TrackingService);
    ts = TestBed.inject(TranslationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should calculate distance correctly (Haversine)', () => {
    // Madrid to Barcelona (approx 504km)
    const madrid = { lat: 40.4168, lng: -3.7038 };
    const barcelona = { lat: 41.3851, lng: 2.1734 };

    // Using any to access private method for testing
    const distance = (service as any).calculateDistance(
      madrid.lat,
      madrid.lng,
      barcelona.lat,
      barcelona.lng,
    );

    // Distance should be approx 504,000 meters
    expect(distance).toBeGreaterThan(500000);
    expect(distance).toBeLessThan(510000);
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
    // Manually set state to bypass startGeolocation geolocation failures in test environment
    service.state.set('tracking');
    (service as any).currentActivityId = 1;

    // Position 1: start at (40.0, 3.0), altitude 100
    const pos1 = {
      coords: { latitude: 40.0, longitude: 3.0, altitude: 100, speed: 1 },
      timestamp: Date.now(),
    } as GeolocationPosition;
    (service as any).handlePosition(pos1);

    // Position 2: small horizontal move (dist > 2m), small altitude fluctuation (100.5m)
    // Since diff (0.5m) is below 2.0m threshold, it should not accumulate climb
    const pos2 = {
      coords: { latitude: 40.0001, longitude: 3.0001, altitude: 100.5, speed: 1 },
      timestamp: Date.now() + 1000,
    } as GeolocationPosition;
    (service as any).handlePosition(pos2);

    expect(service.currentClimb()).toBe(0);

    // Position 3+: significant climb (altitude goes to 115m)
    // We send multiple coordinates to allow the Exponential Moving Average (EMA) to smooth up to the target altitude
    for (let i = 0; i < 15; i++) {
      const posClimb = {
        coords: {
          latitude: 40.0002 + i * 0.0001,
          longitude: 3.0002 + i * 0.0001,
          altitude: 115,
          speed: 1,
        },
        timestamp: Date.now() + 2000 + i * 1000,
      } as GeolocationPosition;
      (service as any).handlePosition(posClimb);
    }

    // Climb should be accumulated since the total change (from 100m to 115m smoothed) is well above the 2.0m threshold
    expect(service.currentClimb()).toBeGreaterThan(10);
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
