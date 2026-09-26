import type { CoordinateSource, Split } from './database';

/**
 * The one place where an activity's numbers are derived from its fixes.
 *
 * The live tracker feeds it every fix as it arrives, and a stored track can be replayed
 * through it to recompute the same numbers after an edit. Both paths run this exact code,
 * so a route that is edited without changing its recorded part keeps the figures it was
 * saved with, instead of drifting between two implementations that were meant to agree.
 *
 * It is pure and synchronous on purpose: no Angular, no I/O, a few dozen floating point
 * operations per fix. That keeps it cheap enough to run on every GPS update for hours
 * and simple enough to test against synthetic tracks with known answers.
 */

/** A fix as the metrics see it. `Coordinate` satisfies this. */
export interface TrackSample {
  lat: number;
  lng: number;
  timestamp: number;
  /** GPS altitude above mean sea level, in meters. */
  altitude?: number | null;
  /** Vertical uncertainty of `altitude`, in meters (68%). */
  altitudeAccuracy?: number | null;
  /** Horizontal uncertainty, in meters (68%). */
  accuracy?: number | null;
  /** Speed the receiver measured (Doppler), in m/s. */
  speed?: number | null;
  /** Barometric pressure at the fix, in hPa, when the device has a barometer. */
  pressure?: number | null;
  /**
   * Recording segment: it increments every time a paused recording resumes. Two fixes in
   * different segments were separated by a pause, so nothing is measured between them.
   */
  segment?: number;
  source?: CoordinateSource;
}

/** Why a fix was left out of the activity, or that it was taken. */
export type FixVerdict = 'accepted' | 'invalid' | 'stale' | 'inaccurate' | 'outlier';

export interface ActivityMetricsOptions {
  /**
   * Stored tracks only contain fixes that were already accepted when they were recorded,
   * so replaying one must not second-guess them: an outlier check could reach a different
   * verdict once the fixes it was compared against are no longer there.
   */
  vetted?: boolean;
  /** Keep the altitude filter's state at every accepted fix, for `smoothAltitudes`. */
  trace?: boolean;
}

/** The altitude filter at one accepted fix, or null where there was no altitude yet. */
export type AltitudeTrace = {
  /** Increments whenever the filter starts over; smoothing never crosses a restart. */
  epoch: number;
  level: number;
  /** Variance of `level` after this fix's measurement, and before it. */
  variance: number;
  predicted: number;
  /** Added to `level` to get the altitude above sea level. */
  offset: number;
} | null;

// --- Horizontal ------------------------------------------------------------

/**
 * Fixes less certain than this are not used at all. Phones report cell and Wi-Fi
 * positions (tens to thousands of meters) while GNSS warms up, and a weak fix under heavy
 * cover can land 50 m off the path; joining the good fixes either side with a straight
 * line is far closer to the truth than a detour through the bad one.
 */
export const MAX_HORIZONTAL_ACCURACY_M = 30;

/**
 * Distance is measured from the last point that was counted, not from the previous fix,
 * and only once the position has moved further than the noise could explain. The step is
 * half the reported accuracy, between these bounds.
 *
 * Measuring from the previous fix instead had two opposite failures: at walking speed
 * with a fix per second every leg is shorter than any noise threshold, so real movement
 * was thrown away, while standing still the jitter between consecutive fixes was added
 * up as if it were a walk.
 */
export const MIN_STEP_M = 2;
export const MAX_STEP_M = 10;
const STEP_ACCURACY_FACTOR = 0.5;

/**
 * A position this far from the last counted point is movement even if the speed says
 * otherwise (a very slow climb, or a receiver that does not report speed). Scaled with
 * the accuracy so that a poor fix wandering around a café table does not qualify.
 */
const DRIFT_ESCAPE_M = 20;
const DRIFT_ESCAPE_ACCURACY_FACTOR = 1.5;

/**
 * Moving versus stopped, with hysteresis so the state does not flicker around a single
 * threshold. The receiver's Doppler speed decides whenever it is available: it is
 * accurate to about a tenth of a meter per second, far better than dividing two noisy
 * positions. Low enough to keep a steep, slow ascent (1.5 km/h) counting as moving.
 */
export const MOVING_START_MPS = 0.4;
export const MOVING_STOP_MPS = 0.2;

/**
 * Up to this gap between fixes, the speed at either end describes the time in between.
 * Beyond it (a tunnel, or no updates while standing still) only the average speed over
 * the gap does.
 */
export const CONTINUOUS_GAP_S = 10;

/**
 * Tracks recorded before pauses were stored cannot tell a pause from a loss of signal,
 * so a gap longer than this is assumed to be a pause, as it always has been for them.
 */
export const PAUSE_GAP_S = 90;

/**
 * A fix further from the previous one than the measured speed and both accuracies can
 * account for is a jump, not a journey. A few in a row that agree with each other are
 * believed instead, so a wrong reference can never lock the track.
 */
const OUTLIER_SPEED_FACTOR = 1.5;
const OUTLIER_SPEED_MARGIN_MPS = 3;
const OUTLIER_MAX_SPEED_MPS = 90;
const OUTLIER_ACCURACY_FACTOR = 2;
const OUTLIER_RECOVERY_FIXES = 3;

/**
 * Top speed is the highest median of five consecutive speeds. A spike, the classic source
 * of a 70 km/h walk, never survives a median; a real peak lasts longer than two fixes.
 */
export const SPEED_WINDOW = 5;

/**
 * While moving, the stretch counted between two points is capped by the distance the
 * receiver's own speed says was travelled in that time, plus a tolerance. Position noise
 * zigzags a slow track and inflates it (a walk measured from positions alone easily comes
 * out several percent long); the Doppler speed does not zigzag. The margin makes up for
 * the cap trimming only the noise that lengthens a stretch, never the noise that shortens
 * it, which on its own would bias every walk short.
 */
const SPEED_CAP_TOLERANCE = 0.15;
const SPEED_CAP_MARGIN_M = 0.25;

// --- Vertical --------------------------------------------------------------

/**
 * Altitude goes through a Kalman filter whose measurement noise is the accuracy each fix
 * reports and whose process noise grows with the ground actually covered: terrain can only
 * rise or fall so much per meter walked. Standing still, the estimate settles and GPS
 * wander stops turning into climbing; moving, it follows the terrain.
 */
const SLOPE_SIGMA = 0.1;
/** Allows slow changes with no horizontal movement: a lift, or weather under a barometer. */
const ALTITUDE_TIME_SIGMA = 0.05;

const DEFAULT_GPS_ALTITUDE_SIGMA_M = 10;
const MIN_GPS_ALTITUDE_SIGMA_M = 2;
/** Altitudes less certain than this are ignored rather than filtered. */
const MAX_GPS_ALTITUDE_SIGMA_M = 50;
/** GNSS vertical error runs at about one and a half times the horizontal one. */
const VERTICAL_FROM_HORIZONTAL = 1.5;

/**
 * A barometer resolves a few centimeters of height; this allows for the pressure bumps
 * of wind and pockets on top of that.
 */
const BARO_ALTITUDE_SIGMA_M = 0.5;
/** Plausible surface pressures. Anything else is a sensor fault, not weather. */
const MIN_PRESSURE_HPA = 300;
const MAX_PRESSURE_HPA = 1100;
/** How fast the barometer's absolute level may wander against GPS (weather), per √s. */
const BARO_OFFSET_DRIFT_SIGMA = 0.1;

/**
 * Climb and descent only count swings between turning points larger than this, which is
 * what separates terrain from what is left of the noise after filtering. GPS altitude
 * wanders by meters over minutes, so only a barometer can resolve the small bumps.
 */
export const GPS_CLIMB_HYSTERESIS_M = 6;
export const BARO_CLIMB_HYSTERESIS_M = 2;

/**
 * Measurements the filter takes in before climb starts counting, so that its first
 * estimate settling onto the real altitude is not mistaken for a climb.
 */
const GPS_WARMUP_SAMPLES = 5;
const BARO_WARMUP_SAMPLES = 3;

/**
 * Grade is the slope fitted to the altitudes measured over this much ground. A fit over
 * every sample, rather than the difference between two filtered altitudes, is unbiased on
 * a steady slope and has no filter lag to catch up with. GPS needs twice the ground a
 * barometer does before its wander stops passing for double-digit grades on the flat.
 */
export const BARO_GRADE_WINDOW_M = 100;
export const GPS_GRADE_WINDOW_M = 200;
/** Grades beyond this are artefacts, not terrain. */
export const GRADE_CAP_PERCENT = 45;

// ---------------------------------------------------------------------------

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

/** Height in the standard atmosphere for a pressure. Only differences are meaningful. */
export function pressureAltitude(hPa: number): number {
  return 44330.77 * (1 - Math.pow(hPa / 1013.25, 0.190263));
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && isFinite(value) ? value : null;
}

function nonNegative(value: number | null | undefined): number | null {
  const v = finite(value);
  return v !== null && v >= 0 ? v : null;
}

function positive(value: number | null | undefined): number | null {
  const v = finite(value);
  return v !== null && v > 0 ? v : null;
}

function distanceBetween(a: TrackSample, b: TrackSample): number {
  return haversine(a.lat, a.lng, b.lat, b.lng);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type VerticalChannel = 'gps' | 'baro';

interface VerticalMeasurement {
  channel: VerticalChannel;
  value: number;
  sigma: number;
}

function gpsAltitudeSigma(sample: TrackSample): number | null {
  const vertical = positive(sample.altitudeAccuracy);
  const horizontal = positive(sample.accuracy);
  const sigma =
    vertical ??
    (horizontal !== null ? horizontal * VERTICAL_FROM_HORIZONTAL : DEFAULT_GPS_ALTITUDE_SIGMA_M);

  if (sigma > MAX_GPS_ALTITUDE_SIGMA_M) return null;
  return Math.max(sigma, MIN_GPS_ALTITUDE_SIGMA_M);
}

/**
 * The barometer wins whenever the fix carries a pressure: GPS altitude wanders by meters
 * from one minute to the next, pressure by centimeters.
 */
function verticalMeasurement(sample: TrackSample): VerticalMeasurement | null {
  const pressure = positive(sample.pressure);
  if (pressure !== null && pressure >= MIN_PRESSURE_HPA && pressure <= MAX_PRESSURE_HPA) {
    return { channel: 'baro', value: pressureAltitude(pressure), sigma: BARO_ALTITUDE_SIGMA_M };
  }

  const altitude = finite(sample.altitude);
  if (altitude === null) return null;

  const sigma = gpsAltitudeSigma(sample);
  return sigma === null ? null : { channel: 'gps', value: altitude, sigma };
}

/**
 * Altitude at every traced fix, smoothed in both directions.
 *
 * The live filter can only look back, so on a climb it trails the terrain. A finished
 * track can also look ahead: this runs the Rauch-Tung-Striebel pass backwards over the
 * filter's own states, which removes that lag and averages each point with both of its
 * sides. It is what a profile should be drawn from; the totals keep the live filter's
 * view, so a route that is only looked at never changes its numbers.
 */
export function smoothAltitudes(trace: AltitudeTrace[]): (number | null)[] {
  const smoothed: (number | null)[] = new Array(trace.length).fill(null);
  let later: { level: number; predicted: number; epoch: number } | null = null;

  for (let i = trace.length - 1; i >= 0; i--) {
    const state = trace[i];
    if (!state) {
      later = null;
      continue;
    }

    let level = state.level;
    if (later && later.epoch === state.epoch && later.predicted > 0) {
      level += (state.variance / later.predicted) * (later.level - state.level);
    }

    smoothed[i] = level + state.offset;
    later = { level, predicted: state.predicted, epoch: state.epoch };
  }

  return smoothed;
}

/** Two fixes either side of a pause, as stored since pauses are recorded. */
function isSegmentBreak(prev: TrackSample, next: TrackSample): boolean {
  return prev.segment !== undefined && next.segment !== undefined && prev.segment !== next.segment;
}

export class ActivityMetrics {
  /** Meters. */
  distance = 0;
  /** Seconds spent moving. */
  movingTime = 0;
  /** Seconds between fixes inside recording segments; the clock the splits run on. */
  elapsed = 0;
  /** m/s, the current speed after spike rejection. Zero while stopped. */
  speed = 0;
  /** m/s. */
  maxSpeed = 0;
  /** %, over the last grade window. */
  grade = 0;
  maxGrade = 0;
  minGrade = 0;
  /** Best estimate of the current altitude above sea level, or null before any. */
  altitude: number | null = null;
  readonly splits: Split[] = [];

  /** One entry per accepted fix when tracing was asked for. */
  readonly trace: AltitudeTrace[] | null;

  private readonly vetted: boolean;

  private last: TrackSample | null = null;
  private anchor: TrackSample | null = null;
  private anchorElapsed = 0;
  private anchorTravel = 0;
  private anchorTravelKnown = true;
  private moving = false;
  private speeds: number[] = [];
  private rejectedInARow = 0;
  private lastSplitElapsed = 0;

  private channel: VerticalChannel | null = null;
  private epoch = 0;
  private level = 0;
  private levelVariance = 0;
  private levelSamples = 0;
  /** The measurement taken at the current fix, for the grade fit. */
  private measured: VerticalMeasurement | null = null;
  private baroOffset: number | null = null;
  private baroOffsetVariance = 0;

  private climbed = 0;
  private descended = 0;
  /** Last confirmed turning point of the altitude, and the extreme reached since. */
  private turnRef: number | null = null;
  private turnExtreme = 0;
  /** Range covered before the first turn, while there is no direction yet. */
  private turnLow = 0;
  private turnHigh = 0;
  private trend: -1 | 0 | 1 = 0;

  private gradeWindow: { distance: number; altitude: number; weight: number }[] = [];

  constructor(options: ActivityMetricsOptions = {}) {
    this.vetted = options.vetted ?? false;
    this.trace = options.trace ? [] : null;
  }

  /** Meters climbed, including the climb in progress. */
  get climb(): number {
    return this.climbed + (this.trend === 1 ? this.turnExtreme - (this.turnRef ?? 0) : 0);
  }

  /** Meters descended, including the descent in progress. */
  get descent(): number {
    return this.descended + (this.trend === -1 ? (this.turnRef ?? 0) - this.turnExtreme : 0);
  }

  /** Take a fix into the activity, or say why it was left out. */
  push(sample: TrackSample): FixVerdict {
    if (!isFinite(sample.lat) || !isFinite(sample.lng) || !isFinite(sample.timestamp)) {
      return 'invalid';
    }

    const prev = this.last;
    // Out of order or repeated: the time between them would be zero or negative.
    if (prev && sample.timestamp <= prev.timestamp) return 'stale';

    const manual = sample.source === 'manual';

    if (!this.vetted && !manual) {
      const accuracy = finite(sample.accuracy);
      if (accuracy !== null && accuracy > MAX_HORIZONTAL_ACCURACY_M) return 'inaccurate';

      if (prev && prev.source !== 'manual' && !isSegmentBreak(prev, sample)) {
        if (this.isOutlier(prev, sample) && ++this.rejectedInARow < OUTLIER_RECOVERY_FIXES) {
          return 'outlier';
        }
      }
    }
    this.rejectedInARow = 0;

    if (!prev || isSegmentBreak(prev, sample)) {
      this.finish();
      this.startSegment(sample);
    } else {
      this.advance(prev, sample);
    }

    this.last = sample;
    return 'accepted';
  }

  /**
   * Count the stretch still pending since the last counted point, when the track ends (or
   * pauses) on the move. Up to a step's worth of meters would otherwise be left out at
   * every pause. Ending stopped, what is pending is only jitter, and stays out.
   */
  finish() {
    const last = this.last;
    const anchor = this.anchor;
    if (!last || !anchor || last === anchor || !this.moving) return;

    const fromAnchor = distanceBetween(anchor, last);
    if (fromAnchor < MIN_STEP_M) return;

    this.addDistance(this.stretch(fromAnchor, true), this.anchorElapsed, this.elapsed);
    this.moveAnchor(last);
  }

  /**
   * The distance to count from the last counted point: the straight line to it, capped
   * while moving by what the measured speed says could have been travelled since.
   */
  private stretch(fromAnchor: number, capped: boolean): number {
    if (!capped || !this.anchorTravelKnown) return fromAnchor;
    return Math.min(fromAnchor, this.anchorTravel * (1 + SPEED_CAP_TOLERANCE) + SPEED_CAP_MARGIN_M);
  }

  private moveAnchor(sample: TrackSample) {
    this.anchor = sample;
    this.anchorElapsed = this.elapsed;
    this.anchorTravel = 0;
    this.anchorTravelKnown = true;
  }

  private isOutlier(prev: TrackSample, sample: TrackSample): boolean {
    const dt = (sample.timestamp - prev.timestamp) / 1000;
    const jump = distanceBetween(prev, sample);
    const uncertainty =
      OUTLIER_ACCURACY_FACTOR *
      Math.hypot(finite(prev.accuracy) ?? 0, finite(sample.accuracy) ?? 0);

    const a = nonNegative(prev.speed);
    const b = nonNegative(sample.speed);
    const speedLimit =
      a === null && b === null
        ? OUTLIER_MAX_SPEED_MPS
        : Math.max(a ?? 0, b ?? 0) * OUTLIER_SPEED_FACTOR + OUTLIER_SPEED_MARGIN_MPS;

    return jump > speedLimit * dt + uncertainty;
  }

  /**
   * The first fix, or the first after a pause: a starting line, not a leg. Also the first
   * recorded fix after a hand-drawn opening, so that the recorded part is measured from
   * the same state it was measured from while it was being recorded.
   */
  private startSegment(sample: TrackSample) {
    this.moveAnchor(sample);
    this.moving = false;
    this.speed = 0;
    this.speeds = [];
    this.resetVertical();
    this.observeVertical(sample, 0, 0);
  }

  private advance(prev: TrackSample, sample: TrackSample) {
    const dt = (sample.timestamp - prev.timestamp) / 1000;
    const leg = distanceBetween(prev, sample);
    const manualLeg = sample.source === 'manual' || prev.source === 'manual';

    const legacyPause =
      !manualLeg && prev.segment === undefined && sample.segment === undefined && dt > PAUSE_GAP_S;
    if (!legacyPause) this.elapsed += dt;

    const moving = manualLeg || this.classifyMovement(prev, sample, dt, leg);
    this.moving = moving;
    if (moving && !legacyPause) this.movingTime += dt;

    // What the receiver's speed says was travelled since the last counted point. Only
    // meaningful while every leg since then had a speed at both ends and no gap.
    const a = nonNegative(prev.speed);
    const b = nonNegative(sample.speed);
    if (!manualLeg && a !== null && b !== null && dt <= CONTINUOUS_GAP_S) {
      this.anchorTravel += ((a + b) / 2) * dt;
    } else {
      this.anchorTravelKnown = false;
    }

    // Distance, from the last counted point.
    const anchor = this.anchor!;
    const fromAnchor = distanceBetween(anchor, sample);
    const step = manualLeg ? MIN_STEP_M : this.stepThreshold(anchor, sample);
    const counts =
      fromAnchor >= step && (moving || fromAnchor >= this.driftEscapeThreshold(anchor, sample));

    if (counts) {
      const meters = this.stretch(fromAnchor, moving && !manualLeg);
      this.addDistance(meters, this.anchorElapsed, this.elapsed);
    }

    if (prev.source === 'manual' && sample.source !== 'manual') {
      this.startSegment(sample);
      return;
    }

    if (counts) this.moveAnchor(sample);

    this.observeSpeed(sample, dt, leg, moving);
    this.observeVertical(sample, moving ? leg : 0, dt);
    if (counts) this.observeGrade();
  }

  private classifyMovement(
    prev: TrackSample,
    sample: TrackSample,
    dt: number,
    leg: number,
  ): boolean {
    if (dt > CONTINUOUS_GAP_S) return leg / dt >= MOVING_START_MPS;

    const threshold = this.moving ? MOVING_STOP_MPS : MOVING_START_MPS;
    const a = nonNegative(prev.speed);
    const b = nonNegative(sample.speed);

    if (a !== null || b !== null) {
      const measured = a !== null && b !== null ? (a + b) / 2 : (a ?? b)!;
      return measured >= threshold;
    }

    // No Doppler speed: judge by how far the position has got from the last counted point,
    // which jitter around a fixed spot never does for long. Short of the next step there is
    // no telling yet, so the state holds for as long as it still could be reached in time.
    const anchor = this.anchor!;
    const span = (sample.timestamp - anchor.timestamp) / 1000;
    if (span <= 0) return this.moving;

    const fromAnchor = distanceBetween(anchor, sample);
    const step = this.stepThreshold(anchor, sample);
    if (fromAnchor < step) return this.moving && step / span >= threshold;
    return fromAnchor / span >= threshold;
  }

  private stepThreshold(a: TrackSample, b: TrackSample): number {
    const accuracy = Math.max(finite(a.accuracy) ?? 0, finite(b.accuracy) ?? 0);
    return Math.min(MAX_STEP_M, Math.max(MIN_STEP_M, accuracy * STEP_ACCURACY_FACTOR));
  }

  private driftEscapeThreshold(a: TrackSample, b: TrackSample): number {
    const accuracy = (finite(a.accuracy) ?? 0) + (finite(b.accuracy) ?? 0);
    return Math.max(DRIFT_ESCAPE_M, accuracy * DRIFT_ESCAPE_ACCURACY_FACTOR);
  }

  private observeSpeed(sample: TrackSample, dt: number, leg: number, moving: boolean) {
    const measured =
      nonNegative(sample.speed) ?? (dt > 0 && dt <= CONTINUOUS_GAP_S ? leg / dt : null);
    if (measured === null) return;

    this.speeds.push(measured);
    if (this.speeds.length > SPEED_WINDOW) this.speeds.shift();

    const filtered = this.speeds.length === SPEED_WINDOW ? median(this.speeds) : null;
    if (filtered !== null && filtered > this.maxSpeed) this.maxSpeed = filtered;
    this.speed = moving ? (filtered ?? measured) : 0;
  }

  /**
   * Add a counted stretch, closing every kilometer it completes. Each split ends at the
   * moment the kilometer was crossed, interpolated along the stretch, rather than at the
   * next fix, which at speed or after a gap can be seconds later.
   */
  private addDistance(meters: number, fromElapsed: number, toElapsed: number) {
    const before = this.distance;
    const after = before + meters;

    for (let km = Math.floor(before / 1000) + 1; km * 1000 <= after; km++) {
      const fraction = (km * 1000 - before) / meters;
      const crossedAt = fromElapsed + fraction * (toElapsed - fromElapsed);
      const time = crossedAt - this.lastSplitElapsed;

      this.splits.push({ kilometer: km, time, speed: time > 0 ? 1000 / time : 0 });
      this.lastSplitElapsed = crossedAt;
    }

    this.distance = after;
  }

  /** Forget the altitude filter, keeping what it had already counted. */
  private resetVertical() {
    this.climbed = this.climb;
    this.descended = this.descent;
    this.turnRef = null;
    this.trend = 0;
    this.channel = null;
    this.levelSamples = 0;
    this.gradeWindow = [];
  }

  private levelWarm(): boolean {
    const needed = this.channel === 'baro' ? BARO_WARMUP_SAMPLES : GPS_WARMUP_SAMPLES;
    return this.channel !== null && this.levelSamples >= needed;
  }

  /**
   * @param ground Horizontal meters covered since the previous fix, zero when stopped.
   * @param dt Seconds since the previous fix.
   */
  private observeVertical(sample: TrackSample, ground: number, dt: number) {
    const measurement = verticalMeasurement(sample);
    this.measured = measurement;
    const processNoise = (SLOPE_SIGMA * ground) ** 2 + ALTITUDE_TIME_SIGMA ** 2 * dt;

    if (!measurement) {
      if (this.channel) this.levelVariance += processNoise;
      this.traceLevel(this.levelVariance);
      return;
    }

    let predicted: number;
    if (measurement.channel !== this.channel) {
      // Switching between barometer and GPS: their levels differ, so the jump between
      // them is not terrain. Start over on the new one.
      if (this.channel) this.resetVertical();
      this.channel = measurement.channel;
      this.epoch++;
      this.level = measurement.value;
      this.levelVariance = measurement.sigma ** 2;
      this.levelSamples = 1;
      predicted = this.levelVariance;
    } else {
      this.levelVariance += processNoise;
      predicted = this.levelVariance;
      const gain = this.levelVariance / (this.levelVariance + measurement.sigma ** 2);
      this.level += gain * (measurement.value - this.level);
      this.levelVariance *= 1 - gain;
      this.levelSamples++;
    }

    if (this.levelWarm()) {
      const hysteresis = this.channel === 'baro' ? BARO_CLIMB_HYSTERESIS_M : GPS_CLIMB_HYSTERESIS_M;
      this.accumulateElevation(this.level, hysteresis);
    }

    if (this.channel === 'baro') this.trackBaroOffset(sample, dt);
    this.altitude = this.level + this.levelOffset();
    this.traceLevel(predicted);
  }

  /** What the filtered level needs to become an altitude above sea level. */
  private levelOffset(): number {
    return this.channel === 'baro' ? (this.baroOffset ?? 0) : 0;
  }

  private traceLevel(predicted: number) {
    if (!this.trace) return;
    this.trace.push(
      this.channel
        ? {
            epoch: this.epoch,
            level: this.level,
            variance: this.levelVariance,
            predicted,
            offset: this.levelOffset(),
          }
        : null,
    );
  }

  /**
   * A barometer measures height changes precisely but its absolute level moves with the
   * weather, while GPS has the level right on average but wanders. The offset between them
   * is followed slowly, so the altitude shown takes its shape from the barometer and its
   * level from GPS. Climb and descent never see this offset.
   */
  private trackBaroOffset(sample: TrackSample, dt: number) {
    const gps = finite(sample.altitude);
    if (gps === null) return;

    const sigma = gpsAltitudeSigma(sample);
    if (sigma === null) return;

    const residual = gps - this.level;
    if (this.baroOffset === null) {
      this.baroOffset = residual;
      this.baroOffsetVariance = sigma ** 2;
      return;
    }

    this.baroOffsetVariance += BARO_OFFSET_DRIFT_SIGMA ** 2 * dt;
    const gain = this.baroOffsetVariance / (this.baroOffsetVariance + sigma ** 2);
    this.baroOffset += gain * (residual - this.baroOffset);
    this.baroOffsetVariance *= 1 - gain;
  }

  /**
   * Count climb and descent as the swings between confirmed turning points. A turn is
   * confirmed once the altitude has come back from its extreme by more than the
   * hysteresis, and then the whole swing up to that extreme counts. Nothing is lost at the
   * top of each climb, and wobbles smaller than the hysteresis never count at all.
   */
  private accumulateElevation(level: number, hysteresis: number) {
    if (this.turnRef === null) {
      this.turnRef = level;
      this.turnLow = level;
      this.turnHigh = level;
      this.trend = 0;
      return;
    }

    if (this.trend === 0) {
      // No direction yet: wait until the range covered is itself larger than the
      // hysteresis, and take the direction from which end of it the altitude is at.
      this.turnLow = Math.min(this.turnLow, level);
      this.turnHigh = Math.max(this.turnHigh, level);
      if (this.turnHigh - this.turnLow >= hysteresis) {
        this.trend = level === this.turnHigh ? 1 : -1;
        this.turnRef = this.trend === 1 ? this.turnLow : this.turnHigh;
        this.turnExtreme = level;
      }
    } else if (this.trend === 1) {
      if (level > this.turnExtreme) {
        this.turnExtreme = level;
      } else if (this.turnExtreme - level >= hysteresis) {
        this.climbed += this.turnExtreme - this.turnRef;
        this.turnRef = this.turnExtreme;
        this.trend = -1;
        this.turnExtreme = level;
      }
    } else {
      if (level < this.turnExtreme) {
        this.turnExtreme = level;
      } else if (level - this.turnExtreme >= hysteresis) {
        this.descended += this.turnRef - this.turnExtreme;
        this.turnRef = this.turnExtreme;
        this.trend = 1;
        this.turnExtreme = level;
      }
    }
  }

  /**
   * Fit a slope to the altitudes measured over the grade window, each weighted by how
   * certain it was. Called at counted points only, so every sample has its own distance
   * and a long stop cannot pile up samples in one place.
   */
  private observeGrade() {
    const measured = this.measured;
    if (!measured || measured.channel !== this.channel) return;

    const window = this.gradeWindow;
    window.push({
      distance: this.distance,
      altitude: measured.value,
      weight: 1 / measured.sigma ** 2,
    });

    // Keep exactly one sample at or beyond the window's far edge.
    const length = this.channel === 'baro' ? BARO_GRADE_WINDOW_M : GPS_GRADE_WINDOW_M;
    while (window.length > 2 && this.distance - window[1].distance >= length) {
      window.shift();
    }
    if (this.distance - window[0].distance < length) return;

    let weights = 0;
    let distances = 0;
    let altitudes = 0;
    for (const p of window) {
      weights += p.weight;
      distances += p.weight * p.distance;
      altitudes += p.weight * p.altitude;
    }
    const meanDistance = distances / weights;
    const meanAltitude = altitudes / weights;

    let spread = 0;
    let covariance = 0;
    for (const p of window) {
      const offset = p.distance - meanDistance;
      spread += p.weight * offset * offset;
      covariance += p.weight * offset * (p.altitude - meanAltitude);
    }
    if (spread <= 0) return;

    const raw = (covariance / spread) * 100;
    this.grade = Math.max(-GRADE_CAP_PERCENT, Math.min(GRADE_CAP_PERCENT, raw));
    if (this.grade > this.maxGrade) this.maxGrade = this.grade;
    if (this.grade < this.minGrade) this.minGrade = this.grade;
  }
}
