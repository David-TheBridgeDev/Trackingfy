import { Injectable, inject } from '@angular/core';
import { Activity, Coordinate, DatabaseService } from './database';
import { ElevationService } from './elevation';
import { computeRouteStats, DISTANCE_THRESHOLD_M, haversine, pathDistance } from './route-stats';

export interface DraftPoint {
  lat: number;
  lng: number;
}

/**
 * What an activity is made of, from the point of view of editing its opening.
 *
 * Hand-drawn points are always a contiguous run at the start of the track, so the two
 * halves separate cleanly and the recorded part can be treated as the immovable base.
 */
export interface OpeningSegmentContext {
  activity: Activity;
  /** The recorded track, with no hand-drawn opening in front of it. */
  gpsCoords: Coordinate[];
  /** The hand-drawn opening currently saved on the activity, oldest first. */
  existingManual: Coordinate[];
}

export interface OpeningSegmentPreview {
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
  /** True when saving would leave the route with no hand-drawn opening at all. */
  clearsOpening: boolean;
}

export type OpeningSegmentFailure =
  | 'no-points'
  | 'no-anchor'
  | 'zero-distance'
  | 'start-after-anchor';

export type OpeningSegmentValidation =
  | { valid: true; preview: OpeningSegmentPreview }
  | { valid: false; reason: OpeningSegmentFailure };

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

/** Epoch milliseconds as the local `YYYY-MM-DDTHH:mm` a datetime-local input expects. */
export function toLocalInputValue(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * The instant a datetime-local value stands for, preferring the exact time it was seeded
 * from when the field still shows it unchanged.
 *
 * The input works in whole minutes, so a saved start time comes back into it truncated.
 * Without this, reopening an edit and saving it untouched would move the start up to a
 * minute earlier and quietly grow the activity, once per visit.
 */
export function resolveStartTime(inputValue: string, seeded: number | null): number | null {
  if (!inputValue) return null;

  const parsed = new Date(inputValue).getTime();
  if (isNaN(parsed)) return null;

  if (seeded !== null && toLocalInputValue(seeded) === inputValue) return seeded;

  return parsed;
}

/**
 * Separate the hand-drawn opening of a track from the part the GPS recorded.
 *
 * Coordinates arrive ordered by timestamp and a drawn opening always precedes the first
 * fix, so the manual points are the leading run and nothing else needs inspecting.
 */
export function splitManualOpening(coords: Coordinate[]): {
  manual: Coordinate[];
  gps: Coordinate[];
} {
  let count = 0;
  while (count < coords.length && coords[count].source === 'manual') {
    count++;
  }

  return { manual: coords.slice(0, count), gps: coords.slice(count) };
}

/**
 * Maintains the segment that was never recorded at the beginning of an activity.
 *
 * The common case: someone starts walking or riding and only remembers to hit record ten
 * minutes later. The recorded track is intact, but the opening stretch is missing from the
 * distance, the duration and the elevation.
 *
 * Saving replaces the whole opening rather than adding to it, so the segment can be
 * redrawn, corrected or removed as many times as needed. That only stays honest because
 * the recorded totals are recoverable: the first drawn point carries the start time the
 * user gave, so the seconds a previous edit contributed are exactly the gap between it and
 * the first recorded fix. Subtracting that gap returns the activity to what the GPS alone
 * saw, and the new segment is applied to that base instead of compounding on top of an
 * already edited number.
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

  /** Whole seconds that a previously saved opening contributed to the activity duration. */
  private savedDuration(context: OpeningSegmentContext): number {
    const { gpsCoords, existingManual } = context;
    if (existingManual.length === 0 || gpsCoords.length === 0) return 0;

    // Rounded the same way it was added, so subtracting it lands back exactly on the
    // recorded duration instead of leaving fractions of a second behind.
    return Math.max(1, Math.round((gpsCoords[0].timestamp - existingManual[0].timestamp) / 1000));
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
  previewOpeningSegment(
    context: OpeningSegmentContext,
    draft: DraftPoint[],
    startTime: number | null,
  ): OpeningSegmentValidation {
    const { activity, gpsCoords, existingManual } = context;

    const anchor = gpsCoords[0];
    if (!anchor) return { valid: false, reason: 'no-anchor' };

    // What the activity looked like before any opening was drawn on it.
    const savedDuration = this.savedDuration(context);
    const baseTotalTime = activity.totalTime - savedDuration;
    const baseMovingTime = (activity.movingTime ?? activity.totalTime) - savedDuration;
    const baseDistance = activity.totalDistance - (activity.manualDistance ?? 0);

    if (draft.length === 0) {
      // Emptying the draft is a real instruction when the route already carries an
      // opening: it means take it off and give me the recorded activity back.
      if (existingManual.length === 0) return { valid: false, reason: 'no-points' };

      return {
        valid: true,
        preview: {
          addedDistance: 0,
          addedDuration: 0,
          impliedSpeed: 0,
          startTime: anchor.timestamp,
          newTotalDistance: baseDistance,
          newTotalTime: baseTotalTime,
          newMovingTime: baseMovingTime,
          newAvgSpeed: baseMovingTime > 0 ? baseDistance / baseMovingTime : 0,
          implausibleSpeed: false,
          clearsOpening: true,
        },
      };
    }

    const addedDistance = this.draftDistance(draft, anchor);
    if (addedDistance <= 0) return { valid: false, reason: 'zero-distance' };

    if (startTime === null || startTime >= anchor.timestamp) {
      return { valid: false, reason: 'start-after-anchor' };
    }

    // Whole seconds, because that is what the live tracker stores and what every
    // duration formatter in the app assumes.
    const addedDuration = Math.max(1, Math.round((anchor.timestamp - startTime) / 1000));
    const impliedSpeed = addedDistance / addedDuration;

    // Duration is carried on the recorded base rather than recomputed: pause intervals
    // are not stored, so the activity's own totals are the only reliable source for them.
    const newTotalTime = baseTotalTime + addedDuration;
    const newMovingTime = baseMovingTime + addedDuration;
    const newTotalDistance = baseDistance + addedDistance;

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
        clearsOpening: false,
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
   * Replace the activity's hand-drawn opening with the current draft and recompute.
   *
   * Geometry-derived metrics (distance, climb, descent, grades, top speed, splits) are
   * recomputed from the merged track. Duration is carried on the recorded base, because
   * pauses leave no trace in the stored coordinates and so cannot be reconstructed.
   */
  async saveOpeningSegment(
    context: OpeningSegmentContext,
    draft: DraftPoint[],
    startTime: number | null,
  ): Promise<Activity> {
    const { activity, gpsCoords, existingManual } = context;
    if (!activity.id) throw new Error('Activity has no id');

    const validation = this.previewOpeningSegment(context, draft, startTime);
    if (!validation.valid) throw new Error(`Cannot edit route: ${validation.reason}`);

    const preview = validation.preview;
    const anchor = gpsCoords[0];

    let manualCoords: Coordinate[] = [];
    if (draft.length > 0) {
      const altitudes = await this.resolveAltitudes(draft, anchor);
      manualCoords = this.buildCoordinates(
        activity.id,
        draft,
        anchor,
        preview.startTime,
        altitudes,
      );
    }

    const merged = [...manualCoords, ...gpsCoords];
    const stats = computeRouteStats(merged, preview.newTotalTime);

    const changes: Partial<Activity> = {
      date: new Date(preview.startTime),
      startTime: preview.startTime,
      totalDistance: stats.totalDistance,
      totalClimb: stats.totalClimb,
      totalDescent: stats.totalDescent,
      maxGrade: stats.maxGrade,
      minGrade: stats.minGrade,
      maxSpeed: stats.maxSpeed,
      splits: stats.splits,
      totalTime: preview.newTotalTime,
      movingTime: preview.newMovingTime,
      avgSpeed: preview.newMovingTime > 0 ? stats.totalDistance / preview.newMovingTime : 0,
      editedAt: Date.now(),
      manualDistance: preview.addedDistance,
    };

    const removedIds = existingManual
      .map((c) => c.id)
      .filter((id): id is number => id !== undefined);

    await this.db.applyRouteEdit(activity.id, removedIds, manualCoords, changes);

    return { ...activity, ...changes };
  }
}
