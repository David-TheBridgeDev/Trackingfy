import { TestBed } from '@angular/core/testing';
import { Activity, Coordinate, DatabaseService } from './database';
import { ElevationService } from './elevation';
import {
  OpeningSegmentContext,
  resolveStartTime,
  RouteEditorService,
  splitManualOpening,
  toLocalInputValue,
} from './route-editor';

const METERS_PER_DEGREE_LAT = (6371e3 * Math.PI) / 180;

/** Latitude that sits `meters` north of the equator, so distances are exact. */
const northOf = (meters: number) => meters / METERS_PER_DEGREE_LAT;

const ANCHOR_TIME = 1_700_000_000_000;

/**
 * A recorded track starting at the equator and running 1 km north: 1 km covered in
 * 500 seconds, so an average of 2 m/s.
 */
function recordedTrack(): Coordinate[] {
  return [
    { activityId: 1, lat: 0, lng: 0, timestamp: ANCHOR_TIME, altitude: 500, speed: 2 },
    {
      activityId: 1,
      lat: northOf(1000),
      lng: 0,
      timestamp: ANCHOR_TIME + 500_000,
      altitude: 500,
      speed: 2,
    },
  ];
}

function recordedActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    date: new Date(ANCHOR_TIME),
    type: 'Cycling',
    totalDistance: 1000,
    totalTime: 500,
    movingTime: 500,
    avgSpeed: 2,
    maxSpeed: 2,
    totalClimb: 0,
    totalDescent: 0,
    startTime: ANCHOR_TIME,
    endTime: ANCHOR_TIME + 500_000,
    ...overrides,
  };
}

/** Two points 200 m and 100 m short of where recording began. */
const draft = [
  { lat: northOf(-200), lng: 0 },
  { lat: northOf(-100), lng: 0 },
];

/** The same two points, as a segment a previous edit already saved. */
function savedOpening(): Coordinate[] {
  return [
    {
      id: 101,
      activityId: 1,
      lat: northOf(-200),
      lng: 0,
      timestamp: ANCHOR_TIME - 100_000,
      altitude: 480,
      speed: 2,
      source: 'manual',
    },
    {
      id: 102,
      activityId: 1,
      lat: northOf(-100),
      lng: 0,
      timestamp: ANCHOR_TIME - 50_000,
      altitude: 490,
      speed: 2,
      source: 'manual',
    },
  ];
}

function freshContext(): OpeningSegmentContext {
  return { activity: recordedActivity(), gpsCoords: recordedTrack(), existingManual: [] };
}

/** An activity whose opening was already drawn once: 200 m and 100 s heavier. */
function editedContext(): OpeningSegmentContext {
  return {
    activity: recordedActivity({
      startTime: ANCHOR_TIME - 100_000,
      totalDistance: 1200,
      totalTime: 600,
      movingTime: 600,
      avgSpeed: 2,
      manualDistance: 200,
      editedAt: ANCHOR_TIME,
    }),
    gpsCoords: recordedTrack(),
    existingManual: savedOpening(),
  };
}

describe('splitManualOpening', () => {
  it('separates the drawn opening from the recorded track', () => {
    const { manual, gps } = splitManualOpening([...savedOpening(), ...recordedTrack()]);

    expect(manual).toHaveLength(2);
    expect(gps).toHaveLength(2);
    expect(gps[0].timestamp).toBe(ANCHOR_TIME);
  });

  it('reports an untouched track as entirely recorded', () => {
    const { manual, gps } = splitManualOpening(recordedTrack());

    expect(manual).toHaveLength(0);
    expect(gps).toHaveLength(2);
  });
});

describe('resolveStartTime', () => {
  // 21:07:30 local: a time the minute-resolution input cannot represent exactly.
  const seeded = new Date(2026, 8, 4, 21, 7, 30, 0).getTime();

  it('parses the field when there is nothing seeded to compare against', () => {
    expect(resolveStartTime('2026-09-04T21:07', null)).toBe(new Date(2026, 8, 4, 21, 7).getTime());
  });

  it('keeps the exact saved instant while the field still shows it', () => {
    // Reopening an edit and saving it untouched must not move the start time, which the
    // truncated field would otherwise do by up to a minute on every visit.
    expect(resolveStartTime(toLocalInputValue(seeded), seeded)).toBe(seeded);
  });

  it('takes the field at its word once the user changes it', () => {
    expect(resolveStartTime('2026-09-04T20:30', seeded)).toBe(
      new Date(2026, 8, 4, 20, 30).getTime(),
    );
  });

  it('reports nothing for an empty or unparseable field', () => {
    expect(resolveStartTime('', seeded)).toBeNull();
    expect(resolveStartTime('not a date', seeded)).toBeNull();
  });
});

describe('RouteEditorService', () => {
  let service: RouteEditorService;
  let applyRouteEdit: ReturnType<typeof vi.fn>;
  let lookup: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    applyRouteEdit = vi.fn().mockResolvedValue(undefined);
    // A terrain model reporting heights on a different reference than the phone: the
    // recorded anchor reads 500 m, the model reads 120 m at the same spot.
    lookup = vi.fn().mockResolvedValue([100, 110, 120]);

    TestBed.configureTestingModule({
      providers: [
        RouteEditorService,
        { provide: DatabaseService, useValue: { applyRouteEdit } },
        { provide: ElevationService, useValue: { lookup } },
      ],
    });

    service = TestBed.inject(RouteEditorService);
  });

  describe('suggestStartTime', () => {
    it('proposes the time implied by the pace held during the recorded part', () => {
      const suggestion = service.suggestStartTime(recordedActivity(), recordedTrack(), draft);

      // 200 m at 2 m/s is 100 seconds before recording began.
      expect(suggestion).toBe(ANCHOR_TIME - 100_000);
    });

    it('has nothing to propose without a drawn segment', () => {
      expect(service.suggestStartTime(recordedActivity(), recordedTrack(), [])).toBeNull();
    });

    it('has nothing to propose when the activity has no usable pace', () => {
      const activity = recordedActivity({
        avgSpeed: 0,
        totalDistance: 0,
        movingTime: 0,
        totalTime: 0,
      });
      expect(service.suggestStartTime(activity, recordedTrack(), draft)).toBeNull();
    });
  });

  describe('previewOpeningSegment', () => {
    it('projects the new totals without touching the database or the network', () => {
      const result = service.previewOpeningSegment(freshContext(), draft, ANCHOR_TIME - 100_000);

      expect(result.valid).toBe(true);
      if (!result.valid) return;

      expect(result.preview.addedDistance).toBeCloseTo(200, 0);
      expect(result.preview.addedDuration).toBe(100);
      expect(result.preview.impliedSpeed).toBeCloseTo(2, 2);
      expect(result.preview.newTotalDistance).toBeCloseTo(1200, 0);
      expect(result.preview.newTotalTime).toBe(600);
      expect(result.preview.newAvgSpeed).toBeCloseTo(2, 2);
      expect(result.preview.implausibleSpeed).toBe(false);
      expect(result.preview.clearsOpening).toBe(false);

      expect(applyRouteEdit).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    });

    it('keeps durations in whole seconds, as every duration formatter assumes', () => {
      // A start time 100.633 seconds before the anchor: the datetime input works in
      // minutes, but an imported or hand-edited value can land anywhere.
      const result = service.previewOpeningSegment(freshContext(), draft, ANCHOR_TIME - 100_633);

      expect(result.valid).toBe(true);
      if (!result.valid) return;

      expect(Number.isInteger(result.preview.addedDuration)).toBe(true);
      expect(Number.isInteger(result.preview.newTotalTime)).toBe(true);
      expect(Number.isInteger(result.preview.newMovingTime)).toBe(true);
    });

    it('refuses a start time that is not before the first recorded fix', () => {
      const result = service.previewOpeningSegment(freshContext(), draft, ANCHOR_TIME);

      expect(result).toEqual({ valid: false, reason: 'start-after-anchor' });
    });

    it('refuses an empty draft on a route that was never edited', () => {
      const result = service.previewOpeningSegment(freshContext(), [], ANCHOR_TIME - 1000);

      expect(result).toEqual({ valid: false, reason: 'no-points' });
    });

    it('refuses an activity with nothing recorded to attach to', () => {
      const result = service.previewOpeningSegment(
        { ...freshContext(), gpsCoords: [] },
        draft,
        ANCHOR_TIME - 1000,
      );

      expect(result).toEqual({ valid: false, reason: 'no-anchor' });
    });

    it('flags a segment speed the activity type cannot sustain', () => {
      // 200 m in 20 seconds is 36 km/h, which nobody walks.
      const result = service.previewOpeningSegment(
        { ...freshContext(), activity: recordedActivity({ type: 'Walking' }) },
        draft,
        ANCHOR_TIME - 20_000,
      );

      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.preview.implausibleSpeed).toBe(true);
    });

    it('redraws an existing opening against the recorded totals, not on top of them', () => {
      const result = service.previewOpeningSegment(editedContext(), draft, ANCHOR_TIME - 100_000);

      expect(result.valid).toBe(true);
      if (!result.valid) return;

      // The activity already carries 1200 m and 600 s from the first edit. Redrawing the
      // same segment must land on the same numbers, not on 1400 m and 700 s.
      expect(result.preview.newTotalDistance).toBeCloseTo(1200, 0);
      expect(result.preview.newTotalTime).toBe(600);
      expect(result.preview.newMovingTime).toBe(600);
    });

    it('projects the recorded activity back when the draft is emptied', () => {
      const result = service.previewOpeningSegment(editedContext(), [], null);

      expect(result.valid).toBe(true);
      if (!result.valid) return;

      expect(result.preview.clearsOpening).toBe(true);
      expect(result.preview.addedDistance).toBe(0);
      expect(result.preview.addedDuration).toBe(0);
      expect(result.preview.newTotalDistance).toBeCloseTo(1000, 0);
      expect(result.preview.newTotalTime).toBe(500);
      expect(result.preview.startTime).toBe(ANCHOR_TIME);
    });
  });

  describe('saveOpeningSegment', () => {
    it('spreads timestamps along the drawn path at a constant speed', async () => {
      await service.saveOpeningSegment(freshContext(), draft, ANCHOR_TIME - 100_000);

      const [, , added] = applyRouteEdit.mock.calls[0];

      expect(added).toHaveLength(2);
      expect(added[0].timestamp).toBe(ANCHOR_TIME - 100_000);
      expect(added[1].timestamp).toBe(ANCHOR_TIME - 50_000);
      expect(added.every((c: Coordinate) => c.timestamp < ANCHOR_TIME)).toBe(true);
      expect(added.every((c: Coordinate) => c.speed === 2)).toBe(true);
    });

    it('marks the added points as drawn rather than recorded', async () => {
      await service.saveOpeningSegment(freshContext(), draft, ANCHOR_TIME - 100_000);

      const [, , added] = applyRouteEdit.mock.calls[0];
      expect(added.every((c: Coordinate) => c.source === 'manual')).toBe(true);
    });

    it('shifts the terrain profile onto the level the GPS recorded', async () => {
      await service.saveOpeningSegment(freshContext(), draft, ANCHOR_TIME - 100_000);

      const [, , added] = applyRouteEdit.mock.calls[0];

      // The model reads 120 m where the track reads 500 m, so the whole profile moves
      // up by 380 m and the drawn segment joins the track without a cliff.
      expect(added[0].altitude).toBeCloseTo(480, 6);
      expect(added[1].altitude).toBeCloseTo(490, 6);
    });

    it('does not invent a climb at the junction with the recorded track', async () => {
      await service.saveOpeningSegment(freshContext(), draft, ANCHOR_TIME - 100_000);

      const [, , , changes] = applyRouteEdit.mock.calls[0];

      // Unshifted, the 380 m step between the model and the track would land here.
      expect(changes.totalClimb).toBeLessThan(20);
    });

    it('leaves the added points without altitude when the terrain model has no answer', async () => {
      lookup.mockResolvedValue([null, null, null]);

      await service.saveOpeningSegment(freshContext(), draft, ANCHOR_TIME - 100_000);

      const [, , added, changes] = applyRouteEdit.mock.calls[0];

      expect(added.every((c: Coordinate) => c.altitude === null)).toBe(true);
      expect(changes.totalClimb).toBe(0);
      expect(changes.totalDescent).toBe(0);
    });

    it('folds the segment into distance, duration and average speed', async () => {
      await service.saveOpeningSegment(freshContext(), draft, ANCHOR_TIME - 100_000);

      const [activityId, removed, , changes] = applyRouteEdit.mock.calls[0];

      expect(activityId).toBe(1);
      expect(removed).toEqual([]);
      expect(changes.totalDistance).toBeCloseTo(1200, 0);
      expect(changes.totalTime).toBe(600);
      expect(changes.movingTime).toBe(600);
      expect(changes.avgSpeed).toBeCloseTo(2, 2);
      expect(changes.startTime).toBe(ANCHOR_TIME - 100_000);
      expect(changes.date.getTime()).toBe(ANCHOR_TIME - 100_000);
      expect(changes.manualDistance).toBeCloseTo(200, 0);
      expect(changes.editedAt).toBeGreaterThan(0);
    });

    it('replaces a previously drawn opening instead of stacking on top of it', async () => {
      await service.saveOpeningSegment(editedContext(), draft, ANCHOR_TIME - 100_000);

      const [, removed, added, changes] = applyRouteEdit.mock.calls[0];

      expect(removed).toEqual([101, 102]);
      expect(added).toHaveLength(2);
      expect(changes.totalDistance).toBeCloseTo(1200, 0);
      expect(changes.totalTime).toBe(600);
      // The stored distance describes the segment that is there now, not a running sum.
      expect(changes.manualDistance).toBeCloseTo(200, 0);
    });

    it('returns the activity to its recorded state when the draft is emptied', async () => {
      await service.saveOpeningSegment(editedContext(), [], null);

      const [, removed, added, changes] = applyRouteEdit.mock.calls[0];

      expect(removed).toEqual([101, 102]);
      expect(added).toEqual([]);
      expect(changes.totalDistance).toBeCloseTo(1000, 0);
      expect(changes.totalTime).toBe(500);
      expect(changes.startTime).toBe(ANCHOR_TIME);
      expect(changes.manualDistance).toBe(0);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('refuses to save a draft that did not validate', async () => {
      await expect(
        service.saveOpeningSegment(freshContext(), draft, ANCHOR_TIME),
      ).rejects.toThrow();

      expect(applyRouteEdit).not.toHaveBeenCalled();
    });
  });
});
