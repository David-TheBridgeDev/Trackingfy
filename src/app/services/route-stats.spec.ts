import { Coordinate } from './database';
import { computeRouteStats, elapsedActiveTimes, haversine, pathDistance } from './route-stats';

/** One degree of latitude in meters, for the Earth radius the haversine uses. */
const METERS_PER_DEGREE_LAT = (6371e3 * Math.PI) / 180;

interface PointSpec {
  spacing?: number; // meters between consecutive points
  altitudes?: (number | null)[];
  intervalSeconds?: number;
  speed?: number;
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

  it('ignores legs below the threshold, as the stats do', () => {
    const points = line(4, { spacing: 1 });
    expect(pathDistance(points, 2)).toBe(0);
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

  it('discards movement below the GPS noise threshold', () => {
    const stats = computeRouteStats(line(50, { spacing: 1 }));
    expect(stats.totalDistance).toBe(0);
  });

  it('emits one split per completed kilometer', () => {
    const stats = computeRouteStats(line(21, { spacing: 100 }));
    expect(stats.splits.map((s) => s.kilometer)).toEqual([1, 2]);
  });

  it('leaves elevation untouched when no point carries an altitude', () => {
    const stats = computeRouteStats(line(10, { spacing: 100 }));
    expect(stats.totalClimb).toBe(0);
    expect(stats.totalDescent).toBe(0);
  });

  it('accumulates climb on a sustained ascent and nothing on the way up for descent', () => {
    const altitudes = Array.from({ length: 10 }, (_, i) => 100 + i * 10);
    const stats = computeRouteStats(line(10, { spacing: 100, altitudes }));

    expect(stats.totalClimb).toBeGreaterThan(0);
    expect(stats.totalDescent).toBe(0);
  });

  it('does not turn barometric jitter into elevation gain', () => {
    const altitudes = Array.from({ length: 20 }, (_, i) => 100 + (i % 2));
    const stats = computeRouteStats(line(20, { spacing: 100, altitudes }));

    expect(stats.totalClimb).toBe(0);
    expect(stats.totalDescent).toBe(0);
  });

  it('takes the top speed from the recorded speed of each fix', () => {
    const coords = line(5, { spacing: 100 });
    coords[2].speed = 7.5;
    coords[3].speed = 3;

    expect(computeRouteStats(coords).maxSpeed).toBe(7.5);
  });
});

describe('elapsedActiveTimes', () => {
  it('accumulates the gaps between fixes', () => {
    const elapsed = elapsedActiveTimes(line(4, { intervalSeconds: 30 }));
    expect(elapsed).toEqual([0, 30, 60, 90]);
  });

  it('treats a long hole in the timestamps as time spent not recording', () => {
    const coords = line(4, { intervalSeconds: 30 });
    // A ten minute hole: either a pause or a loss of signal, neither of which the
    // activity timer would have counted.
    coords[2].timestamp += 600_000;
    coords[3].timestamp += 600_000;

    expect(elapsedActiveTimes(coords)).toEqual([0, 30, 30, 60]);
  });

  it('scales the curve so it ends at the duration the activity actually recorded', () => {
    const elapsed = elapsedActiveTimes(line(4, { intervalSeconds: 30 }), 180);
    expect(elapsed[elapsed.length - 1]).toBe(180);
    expect(elapsed[1]).toBe(60);
  });
});
