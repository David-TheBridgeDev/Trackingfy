import type { Activity, Coordinate, CoordinateSource, Split } from './database';

/**
 * Interchange format for sharing a single route between Trackingfy users.
 *
 * This is deliberately separate from the full backup produced in Settings: it carries one
 * activity and its coordinates, without database ids, so the receiving device can insert
 * it as a new activity of its own. The envelope is versioned so older files keep working
 * as the shape evolves.
 */
export const ROUTE_EXPORT_FORMAT = 'trackingfy.route';
export const ROUTE_EXPORT_VERSION = 1;

export interface ExportedCoordinate {
  lat: number;
  lng: number;
  timestamp: number;
  altitude?: number | null;
  speed?: number | null;
  source?: CoordinateSource;
}

export interface ExportedActivity {
  date: string;
  type: string;
  totalDistance: number;
  totalTime: number;
  movingTime?: number;
  avgSpeed: number;
  maxSpeed?: number;
  maxGrade?: number;
  minGrade?: number;
  totalClimb: number;
  totalDescent: number;
  startTime: number;
  endTime?: number;
  splits?: Split[];
  editedAt?: number;
  manualDistance?: number;
}

export interface RouteExport {
  format: typeof ROUTE_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  activity: ExportedActivity;
  coordinates: ExportedCoordinate[];
}

/** Six decimals is ~11 cm, far below GPS accuracy, and keeps shared files small. */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function buildRouteExport(
  activity: Activity,
  coordinates: Coordinate[],
  appVersion: string,
): RouteExport {
  return {
    format: ROUTE_EXPORT_FORMAT,
    version: ROUTE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    activity: {
      date: new Date(activity.date).toISOString(),
      type: activity.type,
      totalDistance: activity.totalDistance,
      totalTime: activity.totalTime,
      movingTime: activity.movingTime,
      avgSpeed: activity.avgSpeed,
      maxSpeed: activity.maxSpeed,
      maxGrade: activity.maxGrade,
      minGrade: activity.minGrade,
      totalClimb: activity.totalClimb,
      totalDescent: activity.totalDescent,
      startTime: activity.startTime,
      endTime: activity.endTime,
      splits: activity.splits,
      editedAt: activity.editedAt,
      manualDistance: activity.manualDistance,
    },
    coordinates: coordinates.map((c) => ({
      lat: round(c.lat, 6),
      lng: round(c.lng, 6),
      timestamp: c.timestamp,
      altitude: c.altitude === null || c.altitude === undefined ? null : round(c.altitude, 2),
      speed: c.speed === null || c.speed === undefined ? null : round(c.speed, 2),
      source: c.source,
    })),
  };
}

export function isRouteExport(data: any): data is RouteExport {
  return !!data && data.format === ROUTE_EXPORT_FORMAT && Array.isArray(data.coordinates);
}

function isValidCoordinate(c: any): boolean {
  return (
    !!c &&
    typeof c.lat === 'number' &&
    isFinite(c.lat) &&
    c.lat >= -90 &&
    c.lat <= 90 &&
    typeof c.lng === 'number' &&
    isFinite(c.lng) &&
    c.lng >= -180 &&
    c.lng <= 180 &&
    typeof c.timestamp === 'number' &&
    isFinite(c.timestamp)
  );
}

/**
 * Validate a parsed route file and turn it into the records to insert.
 *
 * The returned activity carries no id and the coordinates carry no activityId: the caller
 * assigns both when it writes them, so an imported route never collides with local data.
 */
export function parseRouteExport(data: any): {
  activity: Omit<Activity, 'id'>;
  coordinates: Omit<Coordinate, 'id' | 'activityId'>[];
} {
  if (!isRouteExport(data)) {
    throw new Error('Not a Trackingfy route file');
  }
  if (typeof data.version !== 'number' || data.version > ROUTE_EXPORT_VERSION) {
    throw new Error(`Unsupported route format version: ${data.version}`);
  }

  const source = data.activity as any;
  if (!source || typeof source.startTime !== 'number') {
    throw new Error('Route file has no valid activity');
  }

  const coordinates = data.coordinates.filter(isValidCoordinate);
  if (coordinates.length === 0) {
    throw new Error('Route file has no valid coordinates');
  }

  const activity: Omit<Activity, 'id'> = {
    date: new Date(source.date ?? source.startTime),
    type: typeof source.type === 'string' ? source.type : 'Activity',
    totalDistance: Number(source.totalDistance) || 0,
    totalTime: Number(source.totalTime) || 0,
    movingTime: source.movingTime === undefined ? undefined : Number(source.movingTime) || 0,
    avgSpeed: Number(source.avgSpeed) || 0,
    maxSpeed: source.maxSpeed === undefined ? undefined : Number(source.maxSpeed) || 0,
    maxGrade: source.maxGrade === undefined ? undefined : Number(source.maxGrade) || 0,
    minGrade: source.minGrade === undefined ? undefined : Number(source.minGrade) || 0,
    totalClimb: Number(source.totalClimb) || 0,
    totalDescent: Number(source.totalDescent) || 0,
    startTime: source.startTime,
    endTime: source.endTime === undefined ? undefined : Number(source.endTime),
    splits: Array.isArray(source.splits) ? source.splits : undefined,
    editedAt: source.editedAt === undefined ? undefined : Number(source.editedAt),
    manualDistance:
      source.manualDistance === undefined ? undefined : Number(source.manualDistance) || 0,
  };

  return {
    activity,
    coordinates: coordinates.map((c) => ({
      lat: c.lat,
      lng: c.lng,
      timestamp: c.timestamp,
      altitude: c.altitude ?? null,
      speed: c.speed ?? null,
      source: c.source === 'manual' ? 'manual' : 'gps',
    })),
  };
}
