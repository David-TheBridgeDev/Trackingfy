import { Activity, Coordinate } from './database';
import {
  buildRouteExport,
  isRouteExport,
  parseRouteExport,
  ROUTE_EXPORT_FORMAT,
  ROUTE_EXPORT_VERSION,
} from './route-export';

const activity: Activity = {
  id: 7,
  date: new Date('2026-05-01T08:00:00.000Z'),
  type: 'Cycling',
  totalDistance: 12345.6,
  totalTime: 3600,
  movingTime: 3400,
  avgSpeed: 3.63,
  maxSpeed: 11.2,
  maxGrade: 8.4,
  minGrade: -9.1,
  totalClimb: 320,
  totalDescent: 305,
  startTime: 1777622400000,
  endTime: 1777626000000,
  splits: [{ kilometer: 1, time: 300, speed: 3.33 }],
};

const coordinates: Coordinate[] = [
  {
    id: 1,
    activityId: 7,
    lat: 40.4168123456789,
    lng: -3.7038987654321,
    timestamp: 1777622400000,
    altitude: 667.25,
    speed: 3.5,
    source: 'manual',
  },
  {
    id: 2,
    activityId: 7,
    lat: 40.4178,
    lng: -3.7048,
    timestamp: 1777622460000,
    altitude: null,
    speed: null,
  },
];

describe('buildRouteExport', () => {
  it('stamps the envelope so the receiving app knows what it is reading', () => {
    const payload = buildRouteExport(activity, coordinates, '1.0.3');

    expect(payload.format).toBe(ROUTE_EXPORT_FORMAT);
    expect(payload.version).toBe(ROUTE_EXPORT_VERSION);
    expect(payload.appVersion).toBe('1.0.3');
  });

  it('drops database ids, which mean nothing on another device', () => {
    const payload = buildRouteExport(activity, coordinates, '1.0.3');

    expect((payload.activity as any).id).toBeUndefined();
    expect((payload.coordinates[0] as any).id).toBeUndefined();
    expect((payload.coordinates[0] as any).activityId).toBeUndefined();
  });

  it('rounds coordinates to a precision well below GPS accuracy', () => {
    const payload = buildRouteExport(activity, coordinates, '1.0.3');

    expect(payload.coordinates[0].lat).toBe(40.416812);
    expect(payload.coordinates[0].lng).toBe(-3.703899);
  });

  it('keeps the mark that says which points were drawn by hand', () => {
    const payload = buildRouteExport(activity, coordinates, '1.0.3');
    expect(payload.coordinates[0].source).toBe('manual');
  });
});

describe('parseRouteExport', () => {
  it('round-trips an exported route', () => {
    const parsed = parseRouteExport(
      JSON.parse(JSON.stringify(buildRouteExport(activity, coordinates, '1.0.3'))),
    );

    expect(parsed.activity.type).toBe('Cycling');
    expect(parsed.activity.startTime).toBe(activity.startTime);
    expect(parsed.activity.totalDistance).toBe(activity.totalDistance);
    expect(parsed.activity.date.getTime()).toBe(activity.date.getTime());
    expect(parsed.coordinates).toHaveLength(2);
    expect(parsed.coordinates[0].source).toBe('manual');
    expect(parsed.coordinates[1].source).toBe('gps');
  });

  it('rejects a full backup, which is a different shape entirely', () => {
    const backup = { activities: [activity], coordinates };

    expect(isRouteExport(backup)).toBe(false);
    expect(() => parseRouteExport(backup)).toThrow();
  });

  it('refuses a version it was not built to understand', () => {
    const payload = buildRouteExport(activity, coordinates, '1.0.3');

    expect(() => parseRouteExport({ ...payload, version: ROUTE_EXPORT_VERSION + 1 })).toThrow();
  });

  it('discards coordinates that are not on the planet', () => {
    const payload = buildRouteExport(activity, coordinates, '1.0.3');
    payload.coordinates.push({ lat: 999, lng: 0, timestamp: 1 } as any);

    expect(parseRouteExport(payload).coordinates).toHaveLength(2);
  });

  it('refuses a route with nothing left to import', () => {
    const payload = buildRouteExport(activity, [], '1.0.3');

    expect(() => parseRouteExport(payload)).toThrow();
  });
});
