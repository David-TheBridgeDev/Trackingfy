import { Activity } from './database';
import {
  breakdownBy,
  buildPeriodBuckets,
  findRecords,
  formatBucketLabel,
  formatBucketRange,
  formatBucketYear,
  metricValue,
  nextPeriodStart,
  previousPeriodStart,
  startOfPeriod,
  summarizeActivities,
} from './statistics';

function makeActivity(date: string, overrides: Partial<Activity> = {}): Activity {
  const start = new Date(date).getTime();
  return {
    date: new Date(start),
    type: 'Cycling',
    totalDistance: 10000,
    totalTime: 3600,
    movingTime: 3000,
    avgSpeed: 3,
    totalClimb: 200,
    totalDescent: 150,
    startTime: start,
    endTime: start + 3600000,
    ...overrides,
  };
}

describe('startOfPeriod', () => {
  it('should start weeks on Monday', () => {
    // A Thursday, a Sunday and the Monday itself all belong to the same week.
    expect(startOfPeriod(new Date(2026, 2, 12), 'week').getDate()).toBe(9);
    expect(startOfPeriod(new Date(2026, 2, 15), 'week').getDate()).toBe(9);
    expect(startOfPeriod(new Date(2026, 2, 9), 'week').getDate()).toBe(9);
  });

  it('should start months and years on their first day', () => {
    const month = startOfPeriod(new Date(2026, 2, 12, 23, 40), 'month');
    expect([month.getMonth(), month.getDate(), month.getHours()]).toEqual([2, 1, 0]);

    const year = startOfPeriod(new Date(2026, 2, 12), 'year');
    expect([year.getFullYear(), year.getMonth(), year.getDate()]).toEqual([2026, 0, 1]);
  });

  it('should walk to the next and previous period across year boundaries', () => {
    expect(nextPeriodStart(new Date(2026, 11, 1), 'month').getFullYear()).toBe(2027);
    expect(previousPeriodStart(new Date(2026, 0, 1), 'month').getFullYear()).toBe(2025);
    expect(previousPeriodStart(new Date(2026, 2, 2), 'week').getDate()).toBe(23);
  });
});

describe('buildPeriodBuckets', () => {
  const now = new Date(2026, 2, 20).getTime();

  it('should return nothing when there are no routes', () => {
    expect(buildPeriodBuckets([], 'month', { now })).toEqual([]);
  });

  it('should add up the routes of each month and keep the empty ones in between', () => {
    const buckets = buildPeriodBuckets(
      [
        makeActivity('2026-01-10T10:00:00'),
        makeActivity('2026-01-20T10:00:00'),
        makeActivity('2026-03-02T10:00:00'),
      ],
      'month',
      { now },
    );

    expect(buckets.length).toBe(3);
    expect(buckets.map((b) => b.count)).toEqual([2, 0, 1]);
    expect(buckets[0].distance).toBe(20000);
    expect(buckets[0].movingTime).toBe(6000);
    expect(new Date(buckets[1].start).getMonth()).toBe(1);
  });

  it('should close the chart on the current period even when nothing was recorded in it', () => {
    const buckets = buildPeriodBuckets([makeActivity('2026-01-10T10:00:00')], 'month', { now });

    expect(buckets.length).toBe(3);
    expect(new Date(buckets[buckets.length - 1].start).getMonth()).toBe(2);
    expect(buckets[buckets.length - 1].count).toBe(0);
  });

  it('should keep only the most recent buckets of a long history', () => {
    const buckets = buildPeriodBuckets(
      [makeActivity('2020-01-10T10:00:00'), makeActivity('2026-03-02T10:00:00')],
      'month',
      { now, maxBuckets: 4 },
    );

    expect(buckets.length).toBe(4);
    expect(new Date(buckets[0].start).getMonth()).toBe(11);
    expect(buckets[buckets.length - 1].count).toBe(1);
  });

  it('should group by week from Monday to Sunday', () => {
    const buckets = buildPeriodBuckets(
      [
        makeActivity('2026-03-09T08:00:00'), // Monday
        makeActivity('2026-03-15T20:00:00'), // Sunday of the same week
        makeActivity('2026-03-16T08:00:00'), // the Monday after
      ],
      'week',
      { now: new Date(2026, 2, 16).getTime() },
    );

    expect(buckets.map((b) => b.count)).toEqual([2, 1]);
  });

  it('should keep a route whose date is in the future', () => {
    const buckets = buildPeriodBuckets([makeActivity('2026-05-02T10:00:00')], 'month', { now });

    expect(buckets[buckets.length - 1].count).toBe(1);
    expect(new Date(buckets[buckets.length - 1].start).getMonth()).toBe(4);
  });

  it('should measure a bucket by the chosen metric', () => {
    const [bucket] = buildPeriodBuckets([makeActivity('2026-03-02T10:00:00')], 'month', { now });

    expect(metricValue(bucket, 'distance')).toBe(10000);
    expect(metricValue(bucket, 'time')).toBe(3000);
    expect(metricValue(bucket, 'climb')).toBe(200);
    expect(metricValue(bucket, 'count')).toBe(1);
  });
});

describe('summarizeActivities', () => {
  it('should be empty for an empty selection', () => {
    const summary = summarizeActivities([]);
    expect(summary.count).toBe(0);
    expect(summary.avgSpeed).toBe(0);
    expect(summary.firstDate).toBeNull();
  });

  it('should add the totals and count each day once', () => {
    const summary = summarizeActivities([
      makeActivity('2026-03-02T08:00:00'),
      makeActivity('2026-03-02T18:00:00'),
      makeActivity('2026-03-05T08:00:00'),
    ]);

    expect(summary.count).toBe(3);
    expect(summary.distance).toBe(30000);
    expect(summary.climb).toBe(600);
    expect(summary.activeDays).toBe(2);
    expect(summary.avgDistance).toBe(10000);
    expect(summary.firstDate).toBe(new Date('2026-03-02T08:00:00').getTime());
    expect(summary.lastDate).toBe(new Date('2026-03-05T08:00:00').getTime());
  });

  it('should weigh the average speed by time instead of averaging averages', () => {
    const summary = summarizeActivities([
      makeActivity('2026-03-02T08:00:00', { totalDistance: 30000, movingTime: 3000 }),
      makeActivity('2026-03-03T08:00:00', { totalDistance: 1000, movingTime: 1000 }),
    ]);

    expect(summary.avgSpeed).toBeCloseTo(31000 / 4000, 6);
  });

  it('should fall back to the recorded duration when no moving time was stored', () => {
    const summary = summarizeActivities([
      makeActivity('2026-03-02T08:00:00', { movingTime: undefined, totalTime: 1200 }),
    ]);

    expect(summary.movingTime).toBe(1200);
  });
});

describe('breakdownBy', () => {
  it('should order the slices by distance and give each its share', () => {
    const entries = breakdownBy(
      [
        makeActivity('2026-03-02T08:00:00', { type: 'Walking', totalDistance: 5000 }),
        makeActivity('2026-03-03T08:00:00', { type: 'Cycling', totalDistance: 15000 }),
        makeActivity('2026-03-04T08:00:00', { type: 'Walking', totalDistance: 5000 }),
      ],
      (activity) => activity.type,
    );

    expect(entries.map((e) => e.key)).toEqual(['Cycling', 'Walking']);
    expect(entries[0].share).toBeCloseTo(0.6, 6);
    expect(entries[1].count).toBe(2);
  });

  it('should not divide by zero when nothing was travelled', () => {
    const entries = breakdownBy(
      [makeActivity('2026-03-02T08:00:00', { totalDistance: 0 })],
      (activity) => activity.type,
    );

    expect(entries[0].share).toBe(0);
  });
});

describe('findRecords', () => {
  it('should pick the best route for each metric', () => {
    const long = makeActivity('2026-03-02T08:00:00', { id: 1, totalDistance: 50000 });
    const steep = makeActivity('2026-03-03T08:00:00', { id: 2, totalClimb: 1200 });
    const fast = makeActivity('2026-03-04T08:00:00', { id: 3, avgSpeed: 9 });

    const records = findRecords([long, steep, fast]);
    const byKind = new Map(records.map((record) => [record.kind, record]));

    expect(byKind.get('distance')?.activity.id).toBe(1);
    expect(byKind.get('climb')?.activity.id).toBe(2);
    expect(byKind.get('speed')?.activity.id).toBe(3);
    expect(byKind.get('duration')?.activity.id).toBe(1);
  });

  it('should leave out a metric nothing was recorded for', () => {
    const records = findRecords([
      makeActivity('2026-03-02T08:00:00', { totalClimb: 0, avgSpeed: 0 }),
    ]);

    expect(records.map((r) => r.kind)).toEqual(['distance', 'duration']);
  });

  it('should have no records at all for an empty selection', () => {
    expect(findRecords([])).toEqual([]);
  });
});

describe('bucket labels', () => {
  const [monthBucket] = buildPeriodBuckets([makeActivity('2026-03-02T10:00:00')], 'month', {
    now: new Date(2026, 2, 20).getTime(),
  });

  it('should label a month with its name, and print the year under every January', () => {
    expect(formatBucketLabel(monthBucket, 'month', 'en-GB').toLowerCase()).toContain('mar');
    expect(formatBucketYear(monthBucket, 'month')).toBeNull();

    const [january] = buildPeriodBuckets([makeActivity('2026-01-02T10:00:00')], 'month', {
      now: new Date(2026, 0, 20).getTime(),
    });
    expect(formatBucketLabel(january, 'month', 'en-GB').toLowerCase()).toContain('jan');
    expect(formatBucketYear(january, 'month')).toBe("'26");

    // Weeks are read off their day numbers, and a year bar says its own year.
    expect(formatBucketYear(january, 'week')).toBeNull();
  });

  it('should label a week by the day its Monday falls on', () => {
    const [week] = buildPeriodBuckets([makeActivity('2026-03-12T10:00:00')], 'week', {
      now: new Date(2026, 2, 12).getTime(),
    });

    expect(formatBucketLabel(week, 'week', 'en-GB')).toBe('9/3');
  });

  it('should name the range a week covers, Monday to Sunday', () => {
    const [week] = buildPeriodBuckets([makeActivity('2026-03-12T10:00:00')], 'week', {
      now: new Date(2026, 2, 12).getTime(),
    });

    const range = formatBucketRange(week, 'week', 'en-GB');
    expect(range).toContain('9');
    expect(range).toContain('15');
  });

  it('should name a year by itself', () => {
    const [year] = buildPeriodBuckets([makeActivity('2026-03-12T10:00:00')], 'year', {
      now: new Date(2026, 2, 12).getTime(),
    });

    expect(formatBucketRange(year, 'year', 'es-ES')).toBe('2026');
  });
});
