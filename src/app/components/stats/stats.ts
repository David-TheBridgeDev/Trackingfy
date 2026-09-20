import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Activity, DatabaseService } from '../../services/database';
import {
  CollectionFilter,
  CollectionsService,
  parseCollectionFilter,
} from '../../services/collections';
import { RouteNavigationService } from '../../services/route-navigation';
import { TranslationService } from '../../services/translation';
import { activityTypeIcon } from '../../services/activity-types';
import { UIService } from '../../services/ui';
import {
  BreakdownEntry,
  PeriodBucket,
  RecordKind,
  StatsMetric,
  StatsPeriod,
  activityTime,
  breakdownBy,
  buildPeriodBuckets,
  findRecords,
  formatBucketLabel,
  formatBucketRange,
  formatBucketYear,
  metricValue,
  summarizeActivities,
} from '../../services/statistics';

const TAB_STORAGE_KEY = 'trackingfy_stats_tab';
const PERIOD_STORAGE_KEY = 'trackingfy_stats_period';
const METRIC_STORAGE_KEY = 'trackingfy_stats_metric';

const PERIODS: StatsPeriod[] = ['week', 'month', 'year'];
const METRICS: StatsMetric[] = ['distance', 'time', 'climb', 'count'];

/** Nothing is shorter than this, so a period with a single route is still visible. */
const MIN_BAR_PERCENT = 2;

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key) as T | null;
    return stored !== null && allowed.includes(stored) ? stored : fallback;
  } catch {
    // Private browsing can refuse storage; the screen simply opens on its default.
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Same as above: not being able to remember the choice is not worth an error.
  }
}

/**
 * What the history adds up to: the same routes, read as a training record.
 *
 * The history answers "where is that route"; this screen answers "how much have I been
 * riding lately", which needs the routes grouped along the calendar instead of listed.
 * Everything is driven by two choices -- the collection and the period -- and every
 * number below them obeys both, so a collection of hikes can be read on its own without
 * the rides flattening its chart.
 */
@Component({
  selector: 'app-stats',
  imports: [CommonModule],
  templateUrl: './stats.html',
  styleUrl: './stats.css',
})
export class StatsComponent implements OnInit {
  private db = inject(DatabaseService);
  private router = inject(Router);
  private collectionsService = inject(CollectionsService);
  private routeNavigation = inject(RouteNavigationService);
  private uiService = inject(UIService);
  public ts = inject(TranslationService);

  activities = signal<Activity[]>([]);
  collections = this.collectionsService.collections;

  activeTab = signal<CollectionFilter>(readTab());
  period = signal<StatsPeriod>(readStored(PERIOD_STORAGE_KEY, PERIODS, 'month'));
  metric = signal<StatsMetric>(readStored(METRIC_STORAGE_KEY, METRICS, 'distance'));

  /** Which bar the panel above the chart is describing, by its start time. */
  selectedStart = signal<number | null>(null);

  readonly periods = PERIODS;
  readonly metrics = METRICS;

  private chartScroll = viewChild<ElementRef<HTMLElement>>('chartScroll');

  constructor() {
    // A chart of the last two years opens on the oldest bar unless it is told otherwise,
    // and the interesting end is the recent one.
    effect(() => {
      this.buckets();
      const element = this.chartScroll()?.nativeElement;
      if (!element) return;

      requestAnimationFrame(() => {
        element.scrollLeft = element.scrollWidth;
      });
    });
  }

  async ngOnInit() {
    this.uiService.setFullScreen(false);
    await Promise.all([this.loadActivities(), this.collectionsService.load()]);
    this.ensureValidTab();
  }

  private async loadActivities() {
    const activities = await this.db.getActivities();
    this.activities.set(activities.filter((a) => a.endTime !== undefined));
  }

  /** Fall back to "all" when the open tab's collection is gone. */
  private ensureValidTab() {
    const tab = this.activeTab();
    if (typeof tab === 'number' && !this.collectionsService.byId().has(tab)) this.setTab('all');
  }

  // --- The selection -------------------------------------------------------

  readonly tabs = computed(() =>
    this.collectionsService.buildTabs(this.activities(), {
      all: this.ts.t('collections.all'),
      none: this.ts.t('collections.none'),
    }),
  );

  readonly selection = computed(() => {
    const tab = this.activeTab();
    return this.activities().filter((activity) => this.collectionsService.matches(activity, tab));
  });

  /** Newest first, which is both what the records list shows and the gallery's order. */
  private readonly selectionByDate = computed(() =>
    [...this.selection()].sort((a, b) => activityTime(b) - activityTime(a)),
  );

  readonly summary = computed(() => summarizeActivities(this.selection()));

  readonly hasActivities = computed(() => this.activities().length > 0);

  setTab(key: CollectionFilter) {
    this.activeTab.set(key);
    writeStored(TAB_STORAGE_KEY, String(key));
  }

  isActiveTab(key: CollectionFilter): boolean {
    return this.activeTab() === key;
  }

  setPeriod(period: StatsPeriod) {
    this.period.set(period);
    writeStored(PERIOD_STORAGE_KEY, period);
  }

  setMetric(metric: StatsMetric) {
    this.metric.set(metric);
    writeStored(METRIC_STORAGE_KEY, metric);
  }

  // --- The chart -----------------------------------------------------------

  readonly buckets = computed(() => buildPeriodBuckets(this.selection(), this.period()));

  private readonly maxValue = computed(() => {
    const metric = this.metric();
    return this.buckets().reduce((max, bucket) => Math.max(max, metricValue(bucket, metric)), 0);
  });

  /** The bar being described, defaulting to the most recent one. */
  readonly selectedBucket = computed<PeriodBucket | null>(() => {
    const buckets = this.buckets();
    if (buckets.length === 0) return null;

    const start = this.selectedStart();
    return buckets.find((bucket) => bucket.start === start) ?? buckets[buckets.length - 1];
  });

  /** The bar just before the selected one, which the change is measured against. */
  private readonly previousBucket = computed<PeriodBucket | null>(() => {
    const buckets = this.buckets();
    const selected = this.selectedBucket();
    if (!selected) return null;

    const index = buckets.indexOf(selected);
    return index > 0 ? buckets[index - 1] : null;
  });

  /**
   * How the selected period compares with the one before it, as a percentage.
   *
   * Null where the comparison would be meaningless: nothing recorded in the previous
   * period leaves nothing to grow from, and a first bar has no predecessor at all.
   */
  readonly change = computed<number | null>(() => {
    const selected = this.selectedBucket();
    const previous = this.previousBucket();
    if (!selected || !previous) return null;

    const before = metricValue(previous, this.metric());
    if (before <= 0) return null;

    return ((metricValue(selected, this.metric()) - before) / before) * 100;
  });

  selectBucket(bucket: PeriodBucket) {
    this.selectedStart.set(bucket.start);
  }

  isSelected(bucket: PeriodBucket): boolean {
    return this.selectedBucket()?.start === bucket.start;
  }

  /** A bar's height as a share of the tallest one, floored so it never disappears. */
  barHeight(bucket: PeriodBucket): number {
    const max = this.maxValue();
    if (max <= 0) return 0;

    const value = metricValue(bucket, this.metric());
    if (value <= 0) return 0;

    return Math.max(MIN_BAR_PERCENT, (value / max) * 100);
  }

  bucketLabel(bucket: PeriodBucket): string {
    return formatBucketLabel(bucket, this.period(), this.locale());
  }

  /** The year under a bar, on the bars that start one. */
  bucketYear(bucket: PeriodBucket): string | null {
    return formatBucketYear(bucket, this.period());
  }

  bucketRange(bucket: PeriodBucket): string {
    return formatBucketRange(bucket, this.period(), this.locale());
  }

  /** What the bar is worth under the current metric, formatted for the panel. */
  metricAmount(bucket: PeriodBucket): string {
    const value = metricValue(bucket, this.metric());

    switch (this.metric()) {
      case 'distance':
        return this.formatDistance(value);
      case 'time':
        return this.formatDuration(value);
      case 'climb':
        return `${Math.round(value)} m`;
      case 'count':
        return String(value);
    }
  }

  metricLabel(metric: StatsMetric): string {
    return this.ts.t(`stats.metric.${metric}`);
  }

  periodLabel(period: StatsPeriod): string {
    return this.ts.t(`stats.period.${period}`);
  }

  // --- Breakdowns and records ----------------------------------------------

  readonly typeBreakdown = computed(() =>
    breakdownBy(this.selection(), (activity) => activity.type),
  );

  readonly collectionBreakdown = computed(() =>
    breakdownBy(this.selection(), (activity) => String(this.collectionsService.keyOf(activity))),
  );

  /** The split by collection only says something while every collection is in view. */
  readonly showCollectionBreakdown = computed(
    () => this.activeTab() === 'all' && this.collections().length > 0,
  );

  readonly records = computed(() => findRecords(this.selection()));

  entryLabel(entry: BreakdownEntry, kind: 'type' | 'collection'): string {
    if (kind === 'type') return this.typeLabel(entry.key);
    if (entry.key === 'none') return this.ts.t('collections.none');
    return this.collectionsService.nameOf(Number(entry.key)) ?? this.ts.t('collections.none');
  }

  entryColor(entry: BreakdownEntry): string {
    if (entry.key === 'none') return '#d1d5db';
    return this.collectionsService.colorOf(Number(entry.key));
  }

  recordLabel(kind: RecordKind): string {
    return this.ts.t(`stats.record.${kind}`);
  }

  recordValue(kind: RecordKind, value: number): string {
    switch (kind) {
      case 'distance':
        return this.formatDistance(value);
      case 'climb':
        return `${Math.round(value)} m`;
      case 'duration':
        return this.formatDuration(value);
      case 'speed':
        return `${(value * 3.6).toFixed(1)} km/h`;
    }
  }

  routeName(activity: Activity): string {
    return activity.name?.trim() || this.typeLabel(activity.type);
  }

  typeLabel(type: string): string {
    const label = this.ts.t(`activity.${type}`);
    return label === `activity.${type}` ? type : label;
  }

  typeIcon(type: string): string {
    return activityTypeIcon(type);
  }

  // --- Navigation ----------------------------------------------------------

  /**
   * Open a record's route, with the routes of this screen as its gallery.
   *
   * A record is read as "the longest one of these", so swiping away from it should walk
   * the same selection rather than the history's own tab.
   */
  openActivity(activity: Activity) {
    if (activity.id === undefined) return;

    this.routeNavigation.setSequence(
      this.selectionByDate()
        .map((a) => a.id)
        .filter((id): id is number => id !== undefined),
      this.tabs().find((tab) => tab.key === this.activeTab())?.label ?? null,
    );

    this.router.navigate(['/activity', activity.id]);
  }

  goToHistory() {
    this.router.navigate(['/history']);
  }

  goToDashboard() {
    this.router.navigate(['/dashboard']);
  }

  // --- Formatting ----------------------------------------------------------

  locale(): string {
    return this.ts.currentLang() === 'es' ? 'es-ES' : 'en-GB';
  }

  /** Meters below a kilometre, kilometres above it. */
  formatDistance(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(meters < 100000 ? 1 : 0)} km`;
  }

  /** Hours and minutes: seconds are noise once a total covers a whole month. */
  formatDuration(seconds: number): string {
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.round((total % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  formatChange(change: number): string {
    return `${change > 0 ? '+' : ''}${change.toFixed(0)}%`;
  }
}

/** The tab the user left the statistics on, so the screen opens where they were. */
function readTab(): CollectionFilter {
  try {
    return parseCollectionFilter(localStorage.getItem(TAB_STORAGE_KEY));
  } catch {
    return 'all';
  }
}
