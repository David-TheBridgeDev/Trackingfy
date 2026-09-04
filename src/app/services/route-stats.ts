import { Coordinate, Split } from './database';

/**
 * Pure recomputation of route statistics from a coordinate list.
 *
 * The live tracker in `tracking.ts` computes every metric in streaming while recording.
 * Editing a route a posteriori (or validating an imported one) needs the same numbers
 * derived from stored coordinates instead, so the constants and the algorithm below are
 * deliberate mirrors of the ones used there. Keep both in sync.
 */

/** Minimum horizontal movement between two fixes before they count. Filters GPS noise. */
export const DISTANCE_THRESHOLD_M = 2;
/** Minimum altitude change before it is accumulated as climb or descent. */
export const ALTITUDE_THRESHOLD_M = 2;
/** Exponential moving average factor used to smooth altitude. Lower = smoother, more lag. */
export const ALTITUDE_EMA_ALPHA = 0.2;
/** Distance accumulated before a grade sample is emitted. */
export const GRADE_WINDOW_M = 15;
/** Grades beyond this are GPS artefacts, not terrain. */
export const GRADE_CAP_PERCENT = 45;
/**
 * A gap longer than this between two fixes is treated as inactive time.
 *
 * Pauses are not persisted anywhere: while paused the tracker simply stores no points,
 * so a hole in the timestamps is indistinguishable from a loss of GPS signal. This
 * threshold is the heuristic that separates "still recording" from "not recording".
 */
export const PAUSE_GAP_S = 90;

export interface RouteStats {
  totalDistance: number; // in meters
  totalClimb: number; // in meters
  totalDescent: number; // in meters
  maxGrade: number; // in %
  minGrade: number; // in %
  maxSpeed: number; // in m/s
  splits: Split[];
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // meters
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(df / 2) * Math.sin(df / 2) +
    Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

/**
 * Total distance of an ordered path.
 *
 * `threshold` mirrors the noise filter applied by `computeRouteStats`, so a draft segment
 * previewed to the user adds up to the same number the saved activity ends up showing.
 */
export function pathDistance(points: { lat: number; lng: number }[], threshold = 0): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const leg = haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    if (leg > threshold) total += leg;
  }
  return total;
}

/**
 * Elapsed active seconds at each coordinate, skipping gaps that look like a pause.
 *
 * When `activeTime` is known (the activity's stored duration, which does exclude pauses)
 * the curve is scaled so its last value matches it exactly. That keeps recomputed splits
 * summing to the duration actually displayed to the user, instead of drifting apart from
 * it because of the pause heuristic above.
 */
export function elapsedActiveTimes(coords: Coordinate[], activeTime?: number): number[] {
  const elapsed: number[] = new Array(coords.length).fill(0);

  for (let i = 1; i < coords.length; i++) {
    const dt = (coords[i].timestamp - coords[i - 1].timestamp) / 1000;
    const counted = dt > 0 && dt <= PAUSE_GAP_S ? dt : 0;
    elapsed[i] = elapsed[i - 1] + counted;
  }

  const raw = elapsed[elapsed.length - 1] || 0;
  if (activeTime !== undefined && activeTime > 0 && raw > 0) {
    const factor = activeTime / raw;
    return elapsed.map((e) => e * factor);
  }

  return elapsed;
}

/**
 * Recompute every geometry-derived metric from an ordered coordinate list.
 *
 * Time-derived metrics (totalTime, movingTime) are intentionally absent: they cannot be
 * rebuilt from coordinates because pause intervals are not stored. Callers carry those
 * forward incrementally instead.
 */
export function computeRouteStats(coords: Coordinate[], activeTime?: number): RouteStats {
  const stats: RouteStats = {
    totalDistance: 0,
    totalClimb: 0,
    totalDescent: 0,
    maxGrade: 0,
    minGrade: 0,
    maxSpeed: 0,
    splits: [],
  };

  if (coords.length === 0) return stats;

  for (const c of coords) {
    const speed = c.speed || 0;
    if (speed > stats.maxSpeed) stats.maxSpeed = speed;
  }

  const elapsed = elapsedActiveTimes(coords, activeTime);

  let lastSmoothedAltitude: number | null = coords[0].altitude ?? null;
  let lastAccumulatedAltitude: number | null = coords[0].altitude ?? null;
  let gradeAltitudeBaseline: number | null = null;
  let gradeDistanceAccumulator = 0;
  let lastSplitTime = 0;

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const current = coords[i];
    const dist = haversine(prev.lat, prev.lng, current.lat, current.lng);

    if (dist <= DISTANCE_THRESHOLD_M) continue;

    const previousDistance = stats.totalDistance;
    stats.totalDistance += dist;

    const currentKm = Math.floor(stats.totalDistance / 1000);
    const lastKm = Math.floor(previousDistance / 1000);
    if (currentKm > lastKm) {
      const splitTime = elapsed[i] - lastSplitTime;
      stats.splits.push({
        kilometer: currentKm,
        time: splitTime,
        speed: splitTime > 0 ? 1000 / splitTime : 0,
      });
      lastSplitTime = elapsed[i];
    }

    // Altitude is only processed alongside horizontal movement, so that standing still
    // with a drifting barometer does not manufacture elevation gain.
    const altitude = current.altitude;
    if (altitude === null || altitude === undefined) continue;

    let smoothed = altitude;
    if (lastSmoothedAltitude !== null) {
      smoothed = ALTITUDE_EMA_ALPHA * altitude + (1 - ALTITUDE_EMA_ALPHA) * lastSmoothedAltitude;
    }
    lastSmoothedAltitude = smoothed;

    if (lastAccumulatedAltitude === null) lastAccumulatedAltitude = smoothed;
    if (gradeAltitudeBaseline === null) gradeAltitudeBaseline = smoothed;

    gradeDistanceAccumulator += dist;
    if (gradeDistanceAccumulator >= GRADE_WINDOW_M) {
      const grade = ((smoothed - gradeAltitudeBaseline) / gradeDistanceAccumulator) * 100;
      const capped = Math.max(-GRADE_CAP_PERCENT, Math.min(GRADE_CAP_PERCENT, grade));

      if (capped > stats.maxGrade) stats.maxGrade = capped;
      if (capped < stats.minGrade) stats.minGrade = capped;

      gradeDistanceAccumulator = 0;
      gradeAltitudeBaseline = smoothed;
    }

    const diff = smoothed - lastAccumulatedAltitude;
    if (Math.abs(diff) >= ALTITUDE_THRESHOLD_M) {
      if (diff > 0) {
        stats.totalClimb += diff;
      } else {
        stats.totalDescent += Math.abs(diff);
      }
      lastAccumulatedAltitude = smoothed;
    }
  }

  return stats;
}
