import { Coordinate, Split } from './database';
import {
  ActivityMetrics,
  haversine,
  MIN_STEP_M,
  smoothAltitudes,
  SPEED_WINDOW,
} from './activity-metrics';

/**
 * Route statistics recomputed from a stored coordinate list.
 *
 * Editing a route a posteriori (or validating an imported one) needs the numbers the live
 * tracker produced, derived from stored coordinates instead. Both replay the fixes through
 * the same `ActivityMetrics`, so there is no second implementation to keep in sync.
 */

export { haversine, PAUSE_GAP_S } from './activity-metrics';

/** Minimum stretch counted between two points. Kept under its old name for the editor. */
export const DISTANCE_THRESHOLD_M = MIN_STEP_M;

export interface RouteStats {
  totalDistance: number; // in meters
  totalClimb: number; // in meters
  totalDescent: number; // in meters
  maxGrade: number; // in %
  minGrade: number; // in %
  maxSpeed: number; // in m/s
  splits: Split[];
}

/**
 * Total distance of an ordered path.
 *
 * `threshold` mirrors how hand-drawn points are measured when the route is recomputed:
 * from the last counted point, once it is further away than the threshold. A draft segment
 * previewed to the user therefore adds up to the same number the saved activity shows.
 */
export function pathDistance(points: { lat: number; lng: number }[], threshold = 0): number {
  if (points.length === 0) return 0;

  let total = 0;
  let anchor = points[0];
  for (let i = 1; i < points.length; i++) {
    const leg = haversine(anchor.lat, anchor.lng, points[i].lat, points[i].lng);
    if (leg >= threshold) {
      total += leg;
      anchor = points[i];
    }
  }
  return total;
}

/**
 * Recompute every geometry-derived metric from an ordered coordinate list.
 *
 * Time-derived totals (totalTime, movingTime) are intentionally absent: the activity's
 * duration comes from the recording clock, which the fixes cannot reproduce exactly, so
 * callers carry those forward instead.
 *
 * When `activeTime` is known (the activity's stored duration, which excludes pauses) the
 * splits are scaled so they add up to it, instead of to the time between the first and
 * last fix, which misses the moments before the first fix of each segment arrived.
 */
export function computeRouteStats(coords: Coordinate[], activeTime?: number): RouteStats {
  const metrics = new ActivityMetrics({ vetted: true });
  for (const coord of coords) metrics.push(coord);
  metrics.finish();

  const scale =
    activeTime !== undefined && activeTime > 0 && metrics.elapsed > 0
      ? activeTime / metrics.elapsed
      : 1;

  return {
    totalDistance: metrics.distance,
    totalClimb: metrics.climb,
    totalDescent: metrics.descent,
    maxGrade: metrics.maxGrade,
    minGrade: metrics.minGrade,
    maxSpeed: metrics.maxSpeed,
    splits: metrics.splits.map((split) => ({
      kilometer: split.kilometer,
      time: split.time * scale,
      speed: split.time > 0 ? 1000 / (split.time * scale) : 0,
    })),
  };
}

/**
 * The speed to draw at each coordinate, in m/s: a median over its neighbours, the same
 * spike rejection the top speed goes through, so the chart never peaks above the top
 * speed the route reports.
 */
export function speedProfile(coords: Coordinate[]): number[] {
  const speeds = coords.map((c) => (typeof c.speed === 'number' && c.speed >= 0 ? c.speed : 0));
  const half = Math.floor(SPEED_WINDOW / 2);

  return speeds.map((_, i) => {
    const window = speeds.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b);
    return window[window.length >> 1];
  });
}

/**
 * The altitude to draw at each coordinate, or null where none is known.
 *
 * Raw GPS altitude jumps by meters from one fix to the next, which draws as a saw along
 * the whole profile. This is the altitude the metrics filtered, from the barometer where
 * the route has one, smoothed in both directions since the whole route is known.
 */
export function altitudeProfile(coords: Coordinate[]): (number | null)[] {
  const metrics = new ActivityMetrics({ vetted: true, trace: true });
  const traced = coords.map((coord) =>
    metrics.push(coord) === 'accepted' ? metrics.trace!.length - 1 : -1,
  );

  const smoothed = smoothAltitudes(metrics.trace!);
  return traced.map((index) => (index < 0 ? null : smoothed[index]));
}
