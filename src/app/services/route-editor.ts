import { Injectable, inject } from '@angular/core';
import { Activity, Coordinate, DatabaseService } from './database';
import { ElevationService } from './elevation';
import { computeRouteStats, DISTANCE_THRESHOLD_M, haversine, pathDistance } from './route-stats';

export interface DraftPoint {
  lat: number;
  lng: number;
}

export interface PrependPreview {
  addedDistance: number; // in meters
  addedDuration: number; // in seconds
  impliedSpeed: number; // in m/s, constant across the added segment
  startTime: number; // epoch ms
  newTotalDistance: number; // in meters
  newTotalTime: number; // in seconds
  newMovingTime: number; // in seconds
  newAvgSpeed: number; // in m/s
  /** True when the implied speed is beyond what the activity type plausibly allows. */
  implausibleSpeed: boolean;
}

export type PrependFailure = 'no-points' | 'no-anchor' | 'zero-distance' | 'start-after-anchor';

export type PrependValidation =
  | { valid: true; preview: PrependPreview }
  | { valid: false; reason: PrependFailure };

/**
 * Upper bound of what each activity type can plausibly sustain, in m/s. Used only to warn:
 * the user is describing something that already happened, so we never block them.
 */
const PLAUSIBLE_MAX_SPEED: Record<string, number> = {
  Walking: 2.8, // 10 km/h
  Running: 6.9, // 25 km/h
  Cycling: 16.7, // 60 km/h
};
const DEFAULT_MAX_SPEED = 16.7;

/**
 * Adds a segment that was never recorded to the beginning of an activity.
 *
 * The common case: someone starts walking or riding and only remembers to hit record ten
 * minutes later. The recorded track is intact, but the opening stretch is missing from the
 * distance, the duration and the elevation. This service reconstructs that stretch from
 * points drawn on the map plus the time the user says they really set off, and folds it
 * into the activity statistics.
 */
@Injectable({
  providedIn: 'root',
})
export class RouteEditorService {
  private db = inject(DatabaseService);
  private elevation = inject(ElevationService);

  /**
   * The average speed to attribute to the added segment when the user has not said
   * otherwise: the one they actually held during the recorded part.
   */
  private referenceSpeed(activity: Activity): number {
    if (activity.avgSpeed > 0) return activity.avgSpeed;

    const time = activity.movingTime || activity.totalTime;
    if (time > 0 && activity.totalDistance > 0) return activity.totalDistance / time;

    return 0;
  }

  /**
   * A start time proposed by assuming the missing stretch was covered at the same pace as
   * the rest of the activity. It is only a default: the user is asked to correct it, since
   * only they know when they actually set off.
   */
  suggestStartTime(
    activity: Activity,
    gpsCoords: Coordinate[],
    draft: DraftPoint[],
  ): number | null {
    const anchor = gpsCoords[0];
    if (!anchor || draft.length === 0) return null;

    const distance = this.draftDistance(draft, anchor);
    const speed = this.referenceSpeed(activity);
    if (distance <= 0 || speed <= 0) return null;

    return Math.round(anchor.timestamp - (distance / speed) * 1000);
  }

  /** Distance of the drawn points plus the leg that joins them to the recorded track. */
  draftDistance(draft: DraftPoint[], anchor: Coordinate | undefined): number {
    if (!anchor || draft.length === 0) return 0;
    return pathDistance([...draft, { lat: anchor.lat, lng: anchor.lng }], DISTANCE_THRESHOLD_M);
  }

  /**
   * Project the effect of the edit without touching the database or the network.
   *
   * Elevation is deliberately excluded here: resolving it means calling an external
   * service, which is done once on save rather than on every change to the draft.
   */
  previewPrepend(
    activity: Activity,
    gpsCoords: Coordinate[],
    draft: DraftPoint[],
    startTime: number,
  ): PrependValidation {
    if (draft.length === 0) return { valid: false, reason: 'no-points' };

    const anchor = gpsCoords[0];
    if (!anchor) return { valid: false, reason: 'no-anchor' };

    const addedDistance = this.draftDistance(draft, anchor);
    if (addedDistance <= 0) return { valid: false, reason: 'zero-distance' };

    if (startTime >= anchor.timestamp) return { valid: false, reason: 'start-after-anchor' };

    // Whole seconds, because that is what the live tracker stores and what every
    // duration formatter in the app assumes.
    const addedDuration = Math.max(1, Math.round((anchor.timestamp - startTime) / 1000));
    const impliedSpeed = addedDistance / addedDuration;

    // Duration is carried forward incrementally rather than recomputed: pause intervals
    // are not stored, so the activity own totals are the only reliable source for them.
    const newTotalTime = activity.totalTime + addedDuration;
    const newMovingTime = (activity.movingTime ?? activity.totalTime) + addedDuration;
    const newTotalDistance = activity.totalDistance + addedDistance;

    const maxSpeed = PLAUSIBLE_MAX_SPEED[activity.type] ?? DEFAULT_MAX_SPEED;

    return {
      valid: true,
      preview: {
        addedDistance,
        addedDuration,
        impliedSpeed,
        startTime,
        newTotalDistance,
        newTotalTime,
        newMovingTime,
        newAvgSpeed: newMovingTime > 0 ? newTotalDistance / newMovingTime : 0,
        implausibleSpeed: impliedSpeed > maxSpeed,
      },
    };
  }

  /**
   * Resolve the altitude of the drawn points from a terrain model.
   *
   * The returned profile is shifted so its last sample matches the altitude the GPS
   * recorded at the anchor. Terrain models report height above a geoid while a phone
   * reports an ellipsoidal or barometric altitude, and the two can differ by tens of
   * meters. Without the shift that difference appears as a cliff at the junction between
   * the drawn segment and the recorded one, and the climb accumulator would count it as
   * real elevation gain. Taking the shape from the terrain model and the absolute level
   * from the track keeps the added elevation honest.
   */
  private async resolveAltitudes(
    draft: DraftPoint[],
    anchor: Coordinate,
  ): Promise<(number | null)[]> {
    const samples = await this.elevation.lookup([
      ...draft.map((p) => ({ lat: p.lat, lng: p.lng })),
      { lat: anchor.lat, lng: anchor.lng },
    ]);

    const anchorSample = samples[samples.length - 1];
    const anchorAltitude = anchor.altitude;

    let offset = 0;
    if (
      anchorSample !== null &&
      anchorSample !== undefined &&
      anchorAltitude !== null &&
      anchorAltitude !== undefined
    ) {
      offset = anchorAltitude - anchorSample;
    }

    return samples
      .slice(0, draft.length)
      .map((sample) => (sample === null || sample === undefined ? null : sample + offset));
  }

  /**
   * Build the coordinates for the added segment.
   *
   * Timestamps are spread along the drawn path in proportion to distance, which is the
   * same as assuming a constant speed over the missing stretch. Anything finer would be
   * invention: there is no record of how the pace varied before recording started.
   */
  private buildCoordinates(
    activityId: number,
    draft: DraftPoint[],
    anchor: Coordinate,
    startTime: number,
    altitudes: (number | null)[],
  ): Coordinate[] {
    const path = [...draft, { lat: anchor.lat, lng: anchor.lng }];

    const cumulative: number[] = [0];
    for (let i = 1; i < path.length; i++) {
      cumulative[i] =
        cumulative[i - 1] + haversine(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
    }
    const total = cumulative[cumulative.length - 1];

    const durationMs = anchor.timestamp - startTime;
    const speed = total > 0 && durationMs > 0 ? total / (durationMs / 1000) : 0;

    return draft.map((point, i) => {
      const fraction = total > 0 ? cumulative[i] / total : 0;
      // Never let a drawn point land on or after the first recorded fix, which would make
      // the ordering by timestamp ambiguous.
      const timestamp = Math.min(
        Math.round(startTime + durationMs * fraction),
        anchor.timestamp - 1,
      );

      return {
        activityId,
        lat: point.lat,
        lng: point.lng,
        timestamp,
        altitude: altitudes[i] ?? null,
        speed,
        source: 'manual' as const,
      };
    });
  }

  /**
   * Persist the edit and recompute the activity statistics.
   *
   * Geometry-derived metrics (distance, climb, descent, grades, top speed, splits) are
   * recomputed from the merged track. Duration is carried forward incrementally, because
   * pauses leave no trace in the stored coordinates and so cannot be reconstructed.
   */
  async applyPrepend(
    activity: Activity,
    gpsCoords: Coordinate[],
    draft: DraftPoint[],
    startTime: number,
  ): Promise<{ activity: Activity; coordinates: Coordinate[] }> {
    if (!activity.id) throw new Error('Activity has no id');

    const validation = this.previewPrepend(activity, gpsCoords, draft, startTime);
    if (!validation.valid) throw new Error(`Cannot edit route: ${validation.reason}`);

    const anchor = gpsCoords[0];
    const altitudes = await this.resolveAltitudes(draft, anchor);
    const manualCoords = this.buildCoordinates(activity.id, draft, anchor, startTime, altitudes);

    const merged = [...manualCoords, ...gpsCoords];
    const addedDuration = validation.preview.addedDuration;
    const newTotalTime = activity.totalTime + addedDuration;
    const newMovingTime = (activity.movingTime ?? activity.totalTime) + addedDuration;

    const stats = computeRouteStats(merged, newTotalTime);

    const changes: Partial<Activity> = {
      date: new Date(startTime),
      startTime,
      totalDistance: stats.totalDistance,
      totalClimb: stats.totalClimb,
      totalDescent: stats.totalDescent,
      maxGrade: stats.maxGrade,
      minGrade: stats.minGrade,
      maxSpeed: stats.maxSpeed,
      splits: stats.splits,
      totalTime: newTotalTime,
      movingTime: newMovingTime,
      avgSpeed: newMovingTime > 0 ? stats.totalDistance / newMovingTime : 0,
      editedAt: Date.now(),
      manualDistance: (activity.manualDistance ?? 0) + validation.preview.addedDistance,
    };

    await this.db.applyRouteEdit(activity.id, manualCoords, changes);

    return { activity: { ...activity, ...changes }, coordinates: merged };
  }
}
