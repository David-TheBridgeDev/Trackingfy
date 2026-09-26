import { Coordinate } from './database';
import { ActivityMetrics } from './activity-metrics';
import {
  altitudeProfile,
  computeRouteStats,
  haversine,
  pathDistance,
  speedProfile,
} from './route-stats';

/** One degree of latitude in meters, for the Earth radius the haversine uses. */
const METERS_PER_DEGREE_LAT = (6371e3 * Math.PI) / 180;

interface PointSpec {
  spacing?: number; // meters between consecutive points
  altitudes?: (number | null)[];
  intervalSeconds?: number;
  speed?: number;
  accuracy?: number;
}

/** A straight north-bound track, so distances are exact and easy to reason about. */
function line(count: number, spec: PointSpec = {}): Coordinate[] {
  const spacing = spec.spacing ?? 100;
  const interval = spec.intervalSeconds ?? 60;
  const start = 1_700_000_000_000;

  return Array.from({ length: count }, (_, i) => ({
    activityId: 1,
    lat: (i * spacing) / METERS_PER_DEGREE_LAT,
    lng: 0,
    timestamp: start + i * interval * 1000,
    altitude: spec.altitudes ? spec.altitudes[i] : null,
    speed: spec.speed ?? null,
    accuracy: spec.accuracy ?? null,
  }));
}

describe('haversine', () => {
  it('measures Madrid to Barcelona at roughly 504 km', () => {
    const distance = haversine(40.4168, -3.7038, 41.3851, 2.1734);
    expect(distance).toBeGreaterThan(500000);
    expect(distance).toBeLessThan(510000);
  });
});

describe('pathDistance', () => {
  it('sums the legs of a path', () => {
    const points = line(4, { spacing: 250 });
    expect(pathDistance(points)).toBeCloseTo(750, 0);
  });

  it('measures short legs from the last counted point instead of dropping them', () => {
    // Dropping every leg under the threshold used to lose a slow walk entirely.
    const points = line(7, { spacing: 1 });
    expect(pathDistance(points, 2)).toBeCloseTo(6, 5);
  });
});

describe('computeRouteStats', () => {
  it('returns zeroed stats for an empty track', () => {
    const stats = computeRouteStats([]);
    expect(stats.totalDistance).toBe(0);
    expect(stats.splits).toEqual([]);
  });

  it('accumulates distance across the track', () => {
    const stats = computeRouteStats(line(11, { spacing: 100 }));
    expect(stats.totalDistance).toBeCloseTo(1000, 0);
  });

  it('does not count a creep slower than walking as distance', () => {
    // A meter a minute is GPS drift around a parked phone, not a route.
    const stats = computeRouteStats(line(15, { spacing: 1 }));
    expect(stats.totalDistance).toBe(0);
  });

  it('emits one split per completed kilometer', () => {
    const stats = computeRouteStats(line(21, { spacing: 100 }));
    expect(stats.splits.map((s) => s.kilometer)).toEqual([1, 2]);
  });

  it('scales the splits to the duration the activity actually recorded', () => {
    // 20 legs of a minute each: 1200 s between the first and last fix, 2400 s recorded.
    const stats = computeRouteStats(line(21, { spacing: 100 }), 2400);
    expect(stats.splits[0].time).toBeCloseTo(1200, 5);
    expect(stats.splits[0].speed).toBeCloseTo(1000 / 1200, 5);
  });

  it('leaves elevation untouched when no point carries an altitude', () => {
    const stats = computeRouteStats(line(10, { spacing: 100 }));
    expect(stats.totalClimb).toBe(0);
    expect(stats.totalDescent).toBe(0);
  });

  it('accumulates climb on a sustained ascent and no descent', () => {
    // 198 m up a 10% ramp; the filter's warm-up and its lag at the top cost a few meters.
    const altitudes = Array.from({ length: 100 }, (_, i) => 100 + i * 2);
    const stats = computeRouteStats(
      line(100, { spacing: 20, intervalSeconds: 10, speed: 2, altitudes }),
    );

    expect(stats.totalClimb).toBeGreaterThan(170);
    expect(stats.totalClimb).toBeLessThanOrEqual(198);
    expect(stats.totalDescent).toBe(0);
  });

  it('does not turn altitude jitter into elevation gain', () => {
    const altitudes = Array.from({ length: 40 }, (_, i) => 100 + (i % 2) * 3);
    const stats = computeRouteStats(line(40, { spacing: 100, altitudes }));

    expect(stats.totalClimb).toBe(0);
    expect(stats.totalDescent).toBe(0);
  });

  it('takes the top speed from sustained speeds, not from a single spike', () => {
    const coords = line(12, { spacing: 100, speed: 5 });
    coords[6].speed = 30;

    expect(computeRouteStats(coords).maxSpeed).toBe(5);
  });

  it('reproduces the numbers the live recording produced from the fixes it stored', () => {
    // A walk with jitter, a stop and a climb, fed live and then replayed from storage.
    const live = new ActivityMetrics();
    const stored: Coordinate[] = [];
    for (let i = 0; i < 900; i++) {
      const stopped = i > 300 && i < 420;
      const along = stopped ? 300 * 1.4 : (i - (i >= 420 ? 120 : 0)) * 1.4;
      const fix: Coordinate = {
        activityId: 1,
        lat: (along + Math.sin(i) * 1.5) / METERS_PER_DEGREE_LAT,
        lng: Math.cos(i * 0.7) / 100_000,
        timestamp: 1_700_000_000_000 + i * 1000,
        altitude: 600 + along * 0.05 + Math.sin(i / 3) * 2,
        altitudeAccuracy: 6,
        accuracy: i % 97 === 0 ? 60 : 5,
        speed: stopped ? 0.05 : 1.4,
        segment: 0,
      };
      if (live.push(fix) === 'accepted') stored.push(fix);
    }
    // As the tracker does when the recording is stopped.
    live.finish();

    const replayed = computeRouteStats(stored);
    expect(replayed.totalDistance).toBeCloseTo(live.distance, 6);
    expect(replayed.totalClimb).toBeCloseTo(live.climb, 6);
    expect(replayed.totalDescent).toBeCloseTo(live.descent, 6);
    expect(replayed.maxGrade).toBeCloseTo(live.maxGrade, 6);
    expect(replayed.maxSpeed).toBeCloseTo(live.maxSpeed, 6);
  });
});

describe('altitudeProfile', () => {
  it('has an entry for every coordinate, null where no altitude is known yet', () => {
    const altitudes = [null, null, 100, 101, 102];
    const profile = altitudeProfile(line(5, { spacing: 100, altitudes }));

    expect(profile).toHaveLength(5);
    expect(profile[0]).toBeNull();
    expect(profile[1]).toBeNull();
    expect(profile[4]).not.toBeNull();
  });

  it('follows a steady climb without lagging behind it', () => {
    const altitudes = Array.from({ length: 60 }, (_, i) => 100 + i * 5);
    const profile = altitudeProfile(line(60, { spacing: 50, altitudes, speed: 2 }));

    // Smoothing in both directions leaves no lag in the middle of a constant slope.
    expect(profile[30]).toBeCloseTo(250, 0);
  });
});

describe('speedProfile', () => {
  it('drops a lone spike but keeps a sustained change', () => {
    const coords = line(9, { speed: 4 });
    coords[2].speed = 25;
    for (let i = 5; i < 9; i++) coords[i].speed = 8;

    const speeds = speedProfile(coords);
    expect(speeds[2]).toBe(4);
    expect(speeds[7]).toBe(8);
  });
});
