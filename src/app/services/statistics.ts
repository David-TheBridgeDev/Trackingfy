import { Activity } from './database';

/**
 * Pure aggregation of a route list into the numbers the statistics screen draws.
 *
 * Everything here works on activities that are already in memory: the history loads the
 * whole table anyway, so a second pass over a few thousand rows costs less than asking
 * IndexedDB for sums it cannot compute. Keeping it pure also means the awkward parts --
 * week boundaries, gap filling, ties between records -- can be tested without a screen.
 */

/** How the routes are cut up along the calendar. */
export type StatsPeriod = 'week' | 'month' | 'year';

/** What the bars of the chart measure. */
export type StatsMetric = 'distance' | 'time' | 'climb' | 'count';

/**
 * How many buckets the chart keeps, per period.
 *
 * A window rather than the whole history: a route imported with a broken date would
 * otherwise stretch the chart over decades of empty bars, and nobody reads a year of
 * weeks at a glance anyway. The totals above the chart stay all-time, so nothing is lost,
 * only pushed off the left edge.
 */
export const MAX_BUCKETS: Record<StatsPeriod, number> = {
  week: 52,
  month: 24,
  year: 12,
};

/** One column of the chart: a calendar period and everything recorded inside it. */
export interface PeriodBucket {
  /** Start of the period, in milliseconds, which also identifies the bucket. */
  start: number;
  /** First millisecond of the next period. */
  end: number;
  count: number;
  /** In meters. */
  distance: number;
  /** In seconds, the recorded duration. */
  time: number;
  /** In seconds, excluding the time spent still. */
  movingTime: number;
  /** In meters. */
  climb: number;
  /** In meters. */
  descent: number;
}

/** The all-time numbers of whatever selection the screen is showing. */
export interface StatsSummary {
  count: number;
  distance: number; // in meters
  time: number; // in seconds
  movingTime: number; // in seconds
  climb: number; // in meters
  descent: number; // in meters
  /** Meters per route, so a long history is comparable with a short one. */
  avgDistance: number;
  /** In m/s, over the whole selection rather than an average of averages. */
  avgSpeed: number;
  /** Calendar days with at least one route: how often, not just how much. */
  activeDays: number;
  /** When the selection starts and ends, for the screen's subtitle. */
  firstDate: number | null;
  lastDate: number | null;
}

/** A slice of the selection: one activity type, or one collection. */
export interface BreakdownEntry {
  key: string;
  count: number;
  distance: number;
  time: number;
  climb: number;
  /** Fraction of the selection's distance, 0 to 1, for the bar behind the row. */
  share: number;
}

export type RecordKind = 'distance' | 'climb' | 'duration' | 'speed';

/** The best route of the selection for one metric, so it can be opened from the screen. */
export interface StatsRecord {
  kind: RecordKind;
  activity: Activity;
  /** Meters, meters, seconds or m/s, depending on the kind. */
  value: number;
}

const EMPTY_SUMMARY: StatsSummary = {
  count: 0,
  distance: 0,
  time: 0,
  movingTime: 0,
  climb: 0,
  descent: 0,
  avgDistance: 0,
  avgSpeed: 0,
  activeDays: 0,
  firstDate: null,
  lastDate: null,
};

/** An activity's date, whatever shape it came back in: a backup carries it as a string. */
export function activityTime(activity: Activity): number {
  return new Date(activity.date).getTime();
}

/** Time spent moving, falling back to the recorded duration when it was never stored. */
function movingTimeOf(activity: Activity): number {
  return activity.movingTime ?? activity.totalTime;
}

/** Midnight of the day, in local time: the calendar the user lives in, not UTC. */
function startOfDay(value: Date | number): Date {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * The first moment of the calendar period a date falls in.
 *
 * Weeks start on Monday, which is what both languages of the app assume, and everything
 * is computed in local time so a route recorded at eleven at night is not filed under
 * the following day.
 */
export function startOfPeriod(value: Date | number, period: StatsPeriod): Date {
  const date = new Date(value);

  switch (period) {
    case 'week': {
      const day = startOfDay(date);
      // getDay() is Sunday-first; shifting by six makes Monday the zero.
      day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
      return day;
    }
    case 'month':
      return new Date(date.getFullYear(), date.getMonth(), 1);
    case 'year':
      return new Date(date.getFullYear(), 0, 1);
  }
}

/** The period right after this one. Date's own overflow handles month and year ends. */
export function nextPeriodStart(start: Date | number, period: StatsPeriod): Date {
  const date = new Date(start);

  switch (period) {
    case 'week':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
    case 'month':
      return new Date(date.getFullYear(), date.getMonth() + 1, 1);
    case 'year':
      return new Date(date.getFullYear() + 1, 0, 1);
  }
}

/** The period right before this one. */
export function previousPeriodStart(start: Date | number, period: StatsPeriod): Date {
  const date = new Date(start);

  switch (period) {
    case 'week':
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7);
    case 'month':
      return new Date(date.getFullYear(), date.getMonth() - 1, 1);
    case 'year':
      return new Date(date.getFullYear() - 1, 0, 1);
  }
}

function emptyBucket(start: Date, period: StatsPeriod): PeriodBucket {
  return {
    start: start.getTime(),
    end: nextPeriodStart(start, period).getTime(),
    count: 0,
    distance: 0,
    time: 0,
    movingTime: 0,
    climb: 0,
    descent: 0,
  };
}

function accumulate(bucket: PeriodBucket, activity: Activity): void {
  bucket.count++;
  bucket.distance += activity.totalDistance;
  bucket.time += activity.totalTime;
  bucket.movingTime += movingTimeOf(activity);
  bucket.climb += activity.totalClimb;
  bucket.descent += activity.totalDescent;
}

/**
 * Cut the routes into consecutive calendar periods, oldest first.
 *
 * Periods without a single route are kept as empty buckets: a gap in training is part of
 * what the chart is for, and dropping it would put two distant months side by side as if
 * nothing had happened in between. The walk runs backwards from the most recent period so
 * its length is bounded by the window even when a stray date sits decades in the past.
 */
export function buildPeriodBuckets(
  activities: Activity[],
  period: StatsPeriod,
  options: { maxBuckets?: number; now?: number } = {},
): PeriodBucket[] {
  if (activities.length === 0) return [];

  const max = Math.max(1, options.maxBuckets ?? MAX_BUCKETS[period]);
  const byStart = new Map<number, PeriodBucket>();

  let earliest = Infinity;
  let latest = -Infinity;

  for (const activity of activities) {
    const time = activityTime(activity);
    if (!Number.isFinite(time)) continue;

    const start = startOfPeriod(time, period);
    const key = start.getTime();

    let bucket = byStart.get(key);
    if (!bucket) {
      bucket = emptyBucket(start, period);
      byStart.set(key, bucket);
    }
    accumulate(bucket, activity);

    earliest = Math.min(earliest, key);
    latest = Math.max(latest, key);
  }

  if (!Number.isFinite(earliest)) return [];

  // The current period closes the chart even when it is empty: "nothing this month" is
  // an answer the screen should give, not a bar it should leave out.
  const now = startOfPeriod(options.now ?? Date.now(), period).getTime();
  const buckets: PeriodBucket[] = [];

  let cursor = new Date(Math.max(latest, now));
  for (let i = 0; i < max; i++) {
    const key = cursor.getTime();
    buckets.push(byStart.get(key) ?? emptyBucket(cursor, period));
    if (key <= earliest) break;
    cursor = previousPeriodStart(cursor, period);
  }

  return buckets.reverse();
}

/** What a bucket is worth under the metric the chart is drawing. */
export function metricValue(bucket: PeriodBucket, metric: StatsMetric): number {
  switch (metric) {
    case 'distance':
      return bucket.distance;
    case 'time':
      return bucket.movingTime;
    case 'climb':
      return bucket.climb;
    case 'count':
      return bucket.count;
  }
}

/** The all-time numbers of a selection of routes. */
export function summarizeActivities(activities: Activity[]): StatsSummary {
  if (activities.length === 0) return { ...EMPTY_SUMMARY };

  const days = new Set<number>();
  const summary: StatsSummary = { ...EMPTY_SUMMARY, firstDate: Infinity, lastDate: -Infinity };

  for (const activity of activities) {
    summary.count++;
    summary.distance += activity.totalDistance;
    summary.time += activity.totalTime;
    summary.movingTime += movingTimeOf(activity);
    summary.climb += activity.totalClimb;
    summary.descent += activity.totalDescent;

    const time = activityTime(activity);
    if (Number.isFinite(time)) {
      days.add(startOfDay(time).getTime());
      summary.firstDate = Math.min(summary.firstDate ?? time, time);
      summary.lastDate = Math.max(summary.lastDate ?? time, time);
    }
  }

  summary.activeDays = days.size;
  summary.avgDistance = summary.distance / summary.count;
  // The pace of the whole selection, not the mean of each route's pace: a two-hour ride
  // has to weigh more than a ten-minute walk in the number shown as "average speed".
  summary.avgSpeed = summary.movingTime > 0 ? summary.distance / summary.movingTime : 0;

  if (!Number.isFinite(summary.firstDate ?? NaN)) summary.firstDate = null;
  if (!Number.isFinite(summary.lastDate ?? NaN)) summary.lastDate = null;

  return summary;
}

/**
 * Split a selection along whatever a route is keyed by, biggest share of distance first.
 *
 * Used for both the activity types and the collections: the two lists differ only in the
 * key they group on and in how the screen labels the rows.
 */
export function breakdownBy(
  activities: Activity[],
  keyOf: (activity: Activity) => string,
): BreakdownEntry[] {
  const entries = new Map<string, BreakdownEntry>();
  let total = 0;

  for (const activity of activities) {
    const key = keyOf(activity);
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, count: 0, distance: 0, time: 0, climb: 0, share: 0 };
      entries.set(key, entry);
    }

    entry.count++;
    entry.distance += activity.totalDistance;
    entry.time += movingTimeOf(activity);
    entry.climb += activity.totalClimb;
    total += activity.totalDistance;
  }

  return Array.from(entries.values())
    .map((entry) => ({ ...entry, share: total > 0 ? entry.distance / total : 0 }))
    .sort((a, b) => b.distance - a.distance || b.count - a.count);
}

const RECORD_VALUE: Record<RecordKind, (activity: Activity) => number> = {
  distance: (activity) => activity.totalDistance,
  climb: (activity) => activity.totalClimb,
  duration: (activity) => activity.totalTime,
  speed: (activity) => activity.avgSpeed,
};

/**
 * The best route of the selection for each metric.
 *
 * A record worth zero is left out rather than shown as a tie between empty routes, and
 * the first route wins a tie, which keeps the list stable while the selection is only
 * being filtered.
 */
export function findRecords(activities: Activity[]): StatsRecord[] {
  const kinds: RecordKind[] = ['distance', 'climb', 'duration', 'speed'];
  const records: StatsRecord[] = [];

  for (const kind of kinds) {
    const valueOf = RECORD_VALUE[kind];
    let best: Activity | null = null;
    let bestValue = 0;

    for (const activity of activities) {
      const value = valueOf(activity) || 0;
      if (value > bestValue) {
        best = activity;
        bestValue = value;
      }
    }

    if (best) records.push({ kind, activity: best, value: bestValue });
  }

  return records;
}

/** The short label under a bar: a day for weeks, a month name, or the year. */
export function formatBucketLabel(
  bucket: PeriodBucket,
  period: StatsPeriod,
  locale: string,
): string {
  const start = new Date(bucket.start);

  switch (period) {
    case 'week':
      return `${start.getDate()}/${start.getMonth() + 1}`;
    case 'month':
      return start.toLocaleDateString(locale, { month: 'short' }).replace('.', '');
    case 'year':
      return String(start.getFullYear());
  }
}

/**
 * The year printed under a bar, where the chart crosses into a new one.
 *
 * Only the months need it: a year of weeks is read off the day numbers, and the year
 * buckets say it themselves. Two digits, on a line of its own, because a column narrow
 * enough to fit a year of bars has no room for "ene 26" beside it.
 */
export function formatBucketYear(bucket: PeriodBucket, period: StatsPeriod): string | null {
  const start = new Date(bucket.start);
  if (period !== 'month' || start.getMonth() !== 0) return null;

  return `'${String(start.getFullYear()).slice(-2)}`;
}

/** The full name of a bucket, for the panel that describes the selected one. */
export function formatBucketRange(
  bucket: PeriodBucket,
  period: StatsPeriod,
  locale: string,
): string {
  const start = new Date(bucket.start);

  switch (period) {
    case 'week': {
      const last = new Date(bucket.end - 1);
      const from = start.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
      const to = last.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return `${from} – ${to}`.replace(/\./g, '');
    }
    case 'month':
      return start
        .toLocaleDateString(locale, { month: 'long', year: 'numeric' })
        .replace(/\./g, '');
    case 'year':
      return String(start.getFullYear());
  }
}
