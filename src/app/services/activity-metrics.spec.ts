import {
  ActivityMetrics,
  MAX_HORIZONTAL_ACCURACY_M,
  pressureAltitude,
  smoothAltitudes,
  type TrackSample,
} from './activity-metrics';

/** One degree of latitude in meters, for the Earth radius the haversine uses. */
const METERS_PER_DEGREE_LAT = (6371e3 * Math.PI) / 180;
const T0 = 1_700_000_000_000;

/** Deterministic noise in [-1, 1], so a failing case fails the same way every run. */
function noise(i: number, seed = 1): number {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Standard-atmosphere pressure at a height, the inverse of `pressureAltitude`. */
function pressureAt(meters: number): number {
  return 1013.25 * Math.pow(1 - meters / 44330.77, 1 / 0.190263);
}

interface WalkSpec {
  seconds: number;
  /** m/s, constant; or per second. */
  speed?: number | ((t: number) => number);
  accuracy?: number;
  /** Meters of position noise either side, along and across the track. */
  jitter?: number;
  /** True altitude at a distance along the track. */
  terrain?: (meters: number) => number;
  altitudeNoise?: number;
  barometer?: boolean;
  /** Report the receiver's speed, as every phone does; off to test its absence. */
  doppler?: boolean;
  segment?: number | ((t: number) => number);
  startAt?: number;
}

/** One fix a second along a straight northbound track. */
function walk(spec: WalkSpec): TrackSample[] {
  const fixes: TrackSample[] = [];
  let along = 0;

  for (let t = 0; t < spec.seconds; t++) {
    const speed = typeof spec.speed === 'function' ? spec.speed(t) : (spec.speed ?? 1.4);
    if (t > 0) along += speed;

    const jitter = spec.jitter ?? 0;
    const height = spec.terrain ? spec.terrain(along) : null;

    fixes.push({
      lat: (along + jitter * noise(t, 1)) / METERS_PER_DEGREE_LAT,
      lng: (jitter * noise(t, 2)) / METERS_PER_DEGREE_LAT,
      timestamp: T0 + ((spec.startAt ?? 0) + t) * 1000,
      accuracy: spec.accuracy ?? 5,
      speed: spec.doppler === false ? null : speed,
      altitude: height === null ? null : height + (spec.altitudeNoise ?? 0) * noise(t, 3),
      altitudeAccuracy: height === null ? null : 6,
      pressure: spec.barometer && height !== null ? pressureAt(height) : null,
      segment: typeof spec.segment === 'function' ? spec.segment(t) : (spec.segment ?? 0),
    });
  }

  return fixes;
}

/** Feed a whole track and close it, as stopping a recording does. */
function run(fixes: TrackSample[], vetted = false): ActivityMetrics {
  const metrics = new ActivityMetrics({ vetted });
  for (const fix of fixes) metrics.push(fix);
  metrics.finish();
  return metrics;
}

describe('ActivityMetrics', () => {
  describe('fix quality', () => {
    it('leaves out fixes less accurate than the limit', () => {
      const metrics = new ActivityMetrics();
      const [first, second] = walk({ seconds: 2 });

      expect(metrics.push(first)).toBe('accepted');
      expect(metrics.push({ ...second, accuracy: MAX_HORIZONTAL_ACCURACY_M + 1 })).toBe(
        'inaccurate',
      );
    });

    it('leaves out repeated and out-of-order fixes', () => {
      const metrics = new ActivityMetrics();
      const [first, second] = walk({ seconds: 2 });

      metrics.push(second);
      expect(metrics.push(second)).toBe('stale');
      expect(metrics.push(first)).toBe('stale');
    });

    it('leaves out a jump the measured speed cannot explain', () => {
      const fixes = walk({ seconds: 60 });
      fixes[30] = { ...fixes[30], lat: fixes[30].lat + 150 / METERS_PER_DEGREE_LAT };

      const metrics = new ActivityMetrics();
      const verdicts = fixes.map((f) => metrics.push(f));

      expect(verdicts[30]).toBe('outlier');
      // Without the jump the walk is 59 * 1.4 m; with it, 300 m more.
      expect(metrics.distance).toBeCloseTo(59 * 1.4, 0);
    });

    it('believes a jump once the fixes after it agree with each other', () => {
      // Every fix from 30 on is 200 m further: a stale reference, not a glitch.
      const fixes = walk({ seconds: 60 }).map((f, i) =>
        i < 30 ? f : { ...f, lat: f.lat + 200 / METERS_PER_DEGREE_LAT },
      );

      const metrics = new ActivityMetrics();
      const verdicts = fixes.map((f) => metrics.push(f));

      expect(verdicts.slice(30, 32)).toEqual(['outlier', 'outlier']);
      expect(verdicts[32]).toBe('accepted');
    });

    it('trusts a stored track instead of second-guessing it', () => {
      const fixes = walk({ seconds: 10 });
      fixes[5] = { ...fixes[5], lat: fixes[5].lat + 150 / METERS_PER_DEGREE_LAT };

      const metrics = new ActivityMetrics({ vetted: true });
      expect(fixes.map((f) => metrics.push(f))).not.toContain('outlier');
    });
  });

  describe('distance', () => {
    it('measures a walk sampled every second, whose legs are all under the noise step', () => {
      // 1.4 m legs: the old tracker dropped every one of them and measured nothing.
      const metrics = run(walk({ seconds: 601, speed: 1.4 }));
      expect(metrics.distance).toBeCloseTo(840, -1);
    });

    it('does not turn jitter around a standing phone into distance', () => {
      const metrics = run(walk({ seconds: 600, speed: 0, jitter: 3 }));
      expect(metrics.distance).toBe(0);
      expect(metrics.movingTime).toBe(0);
    });

    it('does not let jitter inflate a slow walk beyond what the speed allows', () => {
      // Two meters of independent jitter every second is far rougher than a phone's GNSS.
      const clean = run(walk({ seconds: 900, speed: 1.2 }));
      const noisy = run(walk({ seconds: 900, speed: 1.2, jitter: 2 }));
      const positionsOnly = run(walk({ seconds: 900, speed: 1.2, jitter: 2, doppler: false }));

      expect(clean.distance).toBeCloseTo(1078.8, -1);
      expect(noisy.distance / clean.distance).toBeLessThan(1.1);
      expect(positionsOnly.distance).toBeGreaterThan(noisy.distance);
    });

    it('still measures a walk from positions when the receiver gives no speed', () => {
      const metrics = run(walk({ seconds: 301, speed: 1.4, doppler: false }));
      expect(metrics.distance).toBeCloseTo(420, -1);
      expect(metrics.movingTime).toBeGreaterThan(280);
    });

    it('measures nothing across a pause', () => {
      const before = walk({ seconds: 100, speed: 2, segment: 0 });
      // Resumed a kilometer further on, after being driven there.
      const after = walk({ seconds: 100, speed: 2, segment: 1, startAt: 600 }).map((f) => ({
        ...f,
        lat: f.lat + 1000 / METERS_PER_DEGREE_LAT,
      }));

      const metrics = run([...before, ...after]);
      expect(metrics.distance).toBeCloseTo(2 * 99 * 2, 0);
      expect(metrics.movingTime).toBeCloseTo(2 * 99, 0);
    });
  });

  describe('time', () => {
    it('counts a gap as moving only if the ground covered over it says so', () => {
      const fixes = walk({ seconds: 20, speed: 3 });
      // A minute in a tunnel at the same speed: 180 m further, 60 s later.
      const exit = walk({ seconds: 20, speed: 3, startAt: 80 }).map((f) => ({
        ...f,
        lat: f.lat + (19 * 3 + 180) / METERS_PER_DEGREE_LAT,
      }));

      const metrics = run([...fixes, ...exit]);
      expect(metrics.movingTime).toBeCloseTo(19 + 61 + 19, 0);
    });

    it('keeps a steep, slow ascent counting as moving', () => {
      const metrics = run(walk({ seconds: 600, speed: (t) => 0.45 + 0.1 * noise(t) }));
      expect(metrics.movingTime).toBeGreaterThan(590);
    });

    it('treats a long gap in a track recorded before pauses were stored as a pause', () => {
      const legacy = walk({ seconds: 20, speed: 2 }).map(({ segment, ...f }) => f);
      const resumed = walk({ seconds: 20, speed: 2, startAt: 1000 }).map(({ segment, ...f }) => ({
        ...f,
        lat: f.lat + 38 / METERS_PER_DEGREE_LAT,
      }));

      const metrics = run([...legacy, ...resumed]);
      expect(metrics.elapsed).toBeCloseTo(38, 5);
    });
  });

  describe('splits', () => {
    it('closes each kilometer at the moment it was crossed', () => {
      // 4 m/s: the first kilometer is crossed at exactly 250 s.
      const metrics = run(walk({ seconds: 600, speed: 4 }));

      expect(metrics.splits[0].kilometer).toBe(1);
      expect(metrics.splits[0].time).toBeCloseTo(250, 3);
      expect(metrics.splits[1].time).toBeCloseTo(250, 3);
    });

    it('closes every kilometer a single long stretch completes', () => {
      const start = walk({ seconds: 5, speed: 5 });
      const far = walk({ seconds: 5, speed: 5, startAt: 600 }).map((f) => ({
        ...f,
        lat: f.lat + 3000 / METERS_PER_DEGREE_LAT,
      }));

      const metrics = run([...start, ...far], true);
      expect(metrics.splits.map((s) => s.kilometer)).toEqual([1, 2, 3]);
    });
  });

  describe('speed', () => {
    it('ignores a lone spike in the measured speed', () => {
      const fixes = walk({ seconds: 120, speed: 3 });
      fixes[60] = { ...fixes[60], speed: 25 };

      expect(run(fixes).maxSpeed).toBeCloseTo(3, 5);
    });

    it('keeps a peak that lasts', () => {
      const metrics = run(walk({ seconds: 120, speed: (t) => (t >= 60 && t < 70 ? 9 : 3) }));
      expect(metrics.maxSpeed).toBeCloseTo(9, 5);
    });
  });

  describe('climb and descent', () => {
    const hill = (meters: number) => 500 + 40 * Math.sin((Math.PI * meters) / 1000);

    it('measures a hill from GPS altitude', () => {
      // Over 3 km at 3 m/s: up 40, down 80, up 80 and down 40 m, 120 each way, with 3 m of
      // altitude noise.
      const metrics = run(walk({ seconds: 1000, speed: 3, terrain: hill, altitudeNoise: 3 }));

      expect(Math.abs(metrics.climb - 120)).toBeLessThan(15);
      expect(Math.abs(metrics.descent - 120)).toBeLessThan(15);
    });

    it('measures the same hill closely from the barometer', () => {
      const metrics = run(
        walk({ seconds: 1000, speed: 3, terrain: hill, altitudeNoise: 3, barometer: true }),
      );

      expect(Math.abs(metrics.climb - 120)).toBeLessThan(4);
      expect(Math.abs(metrics.descent - 120)).toBeLessThan(4);
    });

    it('does not climb while standing still, however the altitude wanders', () => {
      const metrics = run(
        walk({ seconds: 900, speed: 0, terrain: () => 700, altitudeNoise: 8, jitter: 2 }),
      );
      expect(metrics.climb).toBe(0);
      expect(metrics.descent).toBe(0);
    });

    it('does not count flat ground as climbing', () => {
      const metrics = run(walk({ seconds: 1200, speed: 5, terrain: () => 300, altitudeNoise: 4 }));
      expect(metrics.climb).toBe(0);
      expect(metrics.descent).toBe(0);
    });

    it('counts nothing for the jump between GPS altitude and barometer altitude', () => {
      // The barometer comes on halfway: its standard-atmosphere level is nowhere near GPS.
      const fixes = walk({ seconds: 400, speed: 3, terrain: () => 900, barometer: true }).map(
        (f, i) => (i < 200 ? { ...f, pressure: null } : { ...f, pressure: (f.pressure ?? 0) + 5 }),
      );

      const metrics = run(fixes);
      expect(metrics.climb).toBe(0);
      expect(metrics.descent).toBe(0);
    });

    it('reports the altitude above sea level from the barometer, levelled by GPS', () => {
      // Weather has moved the pressure by 3 hPa: the barometer alone would be 25 m off.
      const fixes = walk({ seconds: 600, speed: 2, terrain: () => 1200, barometer: true }).map(
        (f) => ({ ...f, pressure: f.pressure! - 3 }),
      );

      const metrics = run(fixes);
      expect(metrics.altitude).not.toBeNull();
      expect(Math.abs(metrics.altitude! - 1200)).toBeLessThan(2);
    });
  });

  describe('grade', () => {
    it('measures a steady slope', () => {
      const metrics = run(
        walk({ seconds: 600, speed: 2, terrain: (m) => 100 + 0.08 * m, barometer: true }),
      );

      expect(metrics.grade).toBeCloseTo(8, 0);
      expect(metrics.maxGrade).toBeCloseTo(8, 0);
    });

    it('does not read double-digit grades into GPS noise on the flat', () => {
      const metrics = run(walk({ seconds: 1500, speed: 4, terrain: () => 50, altitudeNoise: 5 }));

      expect(metrics.maxGrade).toBeLessThan(5);
      expect(metrics.minGrade).toBeGreaterThan(-5);
    });
  });

  describe('hand-drawn opening', () => {
    it('measures the recorded part after it exactly as it was measured live', () => {
      const recorded = walk({
        seconds: 900,
        speed: 1.4,
        jitter: 1.5,
        terrain: (m) => 300 + m / 20,
      });
      const live = run(recorded);

      // Two drawn points before the first fix, 500 m apart, as the route editor stores them.
      const first = recorded[0];
      const opening: TrackSample[] = [0, 1].map((i) => ({
        lat: first.lat - ((2 - i) * 500) / METERS_PER_DEGREE_LAT,
        lng: first.lng,
        timestamp: T0 - (2 - i) * 360_000,
        altitude: 280 + i * 10,
        speed: 500 / 360,
        source: 'manual',
      }));

      const edited = run([...opening, ...recorded], true);

      expect(edited.distance - live.distance).toBeCloseTo(1000, 0);
      expect(edited.movingTime - live.movingTime).toBeCloseTo(720, 0);
    });
  });
});

describe('smoothAltitudes', () => {
  it('removes the lag the live filter leaves on a climb', () => {
    const metrics = new ActivityMetrics({ trace: true });
    const fixes = walk({ seconds: 300, speed: 2, terrain: (m) => 100 + 0.1 * m });
    const lagging: number[] = [];
    for (const fix of fixes) {
      metrics.push(fix);
      lagging.push(metrics.altitude ?? NaN);
    }

    const smoothed = smoothAltitudes(metrics.trace!);
    const truth = 100 + 0.1 * 2 * 150;

    expect(Math.abs(smoothed[150]! - truth)).toBeLessThan(0.5);
    expect(Math.abs(lagging[150] - truth)).toBeGreaterThan(Math.abs(smoothed[150]! - truth));
  });

  it('leaves gaps where there was no altitude', () => {
    const metrics = new ActivityMetrics({ trace: true });
    for (const fix of walk({ seconds: 3 })) metrics.push(fix);

    expect(smoothAltitudes(metrics.trace!)).toEqual([null, null, null]);
  });
});

describe('pressureAltitude', () => {
  it('turns a hectopascal into about eight meters near sea level', () => {
    expect(pressureAltitude(1012.25) - pressureAltitude(1013.25)).toBeCloseTo(8.3, 1);
  });
});
