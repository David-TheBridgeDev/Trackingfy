import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Activity, Collection, DatabaseService } from '../../services/database';
import { RouteNavigationService } from '../../services/route-navigation';
import { TranslationService } from '../../services/translation';
import { StatsComponent } from './stats';

function makeActivity(overrides: Partial<Activity> & { id: number; date: Date }): Activity {
  const start = overrides.date.getTime();
  return {
    type: 'Cycling',
    totalDistance: 10000,
    totalTime: 3600,
    movingTime: 3000,
    avgSpeed: 3,
    totalClimb: 100,
    totalDescent: 100,
    startTime: start,
    endTime: start + 3600000,
    ...overrides,
  };
}

function makeCollection(id: number, name: string): Collection {
  return { id, name, color: '#efbc21', order: id, createdAt: id };
}

describe('StatsComponent', () => {
  let component: StatsComponent;
  let fixture: ComponentFixture<StatsComponent>;

  const mockDatabaseService = {
    getActivities: vi.fn(),
    getCollections: vi.fn(),
  };

  const activities = [
    makeActivity({ id: 1, date: new Date(2026, 1, 10), collectionId: 1, totalDistance: 20000 }),
    makeActivity({ id: 2, date: new Date(2026, 2, 3), collectionId: 1, totalClimb: 900 }),
    makeActivity({ id: 3, date: new Date(2026, 2, 4), type: 'Walking', totalDistance: 4000 }),
    // Still being recorded: it has no end time, so no list counts it.
    makeActivity({ id: 4, date: new Date(2026, 2, 5), endTime: undefined }),
  ];

  async function create() {
    fixture = TestBed.createComponent(StatsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();

    mockDatabaseService.getActivities.mockResolvedValue(activities);
    mockDatabaseService.getCollections.mockResolvedValue([makeCollection(1, 'Monte')]);

    await TestBed.configureTestingModule({
      imports: [StatsComponent],
      providers: [provideRouter([]), { provide: DatabaseService, useValue: mockDatabaseService }],
    }).compileComponents();

    // The labels asserted below are translated, so the language cannot be left to
    // whatever locale the test environment happens to report.
    TestBed.inject(TranslationService).setLanguage('en');

    await create();
  });

  it('should leave out the activity still being recorded', () => {
    expect(component.activities().map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it('should total up every finished route', () => {
    const summary = component.summary();

    expect(summary.count).toBe(3);
    expect(summary.distance).toBe(34000);
    expect(summary.climb).toBe(1100);
    expect(summary.activeDays).toBe(3);
  });

  it('should narrow every number to the open collection', () => {
    component.setTab(1);

    expect(component.summary().count).toBe(2);
    expect(component.summary().distance).toBe(30000);
    expect(component.buckets().reduce((total, b) => total + b.count, 0)).toBe(2);
    expect(component.records().every((record) => record.activity.collectionId === 1)).toBe(true);
  });

  it('should offer a tab for the routes outside every collection', () => {
    expect(component.tabs().map((tab) => tab.key)).toEqual(['all', 1, 'none']);
    expect(component.tabs().map((tab) => tab.count)).toEqual([3, 2, 1]);
  });

  it('should regroup the chart when the period changes', () => {
    component.setPeriod('month');
    const months = component.buckets().filter((bucket) => bucket.count > 0).length;

    component.setPeriod('year');
    const years = component.buckets().filter((bucket) => bucket.count > 0).length;

    expect(months).toBe(2);
    expect(years).toBe(1);
  });

  it('should describe the most recent period until a bar is picked', () => {
    component.setPeriod('month');
    const last = component.buckets()[component.buckets().length - 1];
    expect(component.selectedBucket()).toBe(last);

    const first = component.buckets()[0];
    component.selectBucket(first);
    expect(component.selectedBucket()).toBe(first);
    expect(component.isSelected(first)).toBe(true);
  });

  it('should measure the bars against the tallest one, and keep an empty one flat', () => {
    component.setPeriod('month');
    component.setMetric('distance');

    const heights = component.buckets().map((bucket) => component.barHeight(bucket));
    expect(Math.max(...heights)).toBe(100);
    expect(heights.every((height) => height === 0 || height >= 2)).toBe(true);

    const empty = component.buckets().find((bucket) => bucket.count === 0);
    if (empty) expect(component.barHeight(empty)).toBe(0);
  });

  it('should compare a period with the one before it', () => {
    component.setPeriod('month');
    component.setMetric('distance');

    const [february, march] = component.buckets();
    component.selectBucket(february);
    expect(component.change()).toBeNull();

    component.selectBucket(march);
    // 20 km in February, 14 km in March.
    expect(component.change()).toBeCloseTo(-30, 6);
  });

  it('should split the distance by activity type', () => {
    const [first, second] = component.typeBreakdown();

    expect(first.key).toBe('Cycling');
    expect(first.share).toBeCloseTo(30000 / 34000, 6);
    expect(second.key).toBe('Walking');
    expect(component.entryLabel(second, 'type')).toBe('Walking');
  });

  it('should split by collection only while every collection is in view', () => {
    expect(component.showCollectionBreakdown()).toBe(true);
    expect(component.collectionBreakdown().map((entry) => entry.key)).toEqual(['1', 'none']);
    expect(component.entryLabel(component.collectionBreakdown()[0], 'collection')).toBe('Monte');

    component.setTab(1);
    expect(component.showCollectionBreakdown()).toBe(false);
  });

  it('should open a record with the shown routes as its gallery', () => {
    const router = TestBed.inject(Router);
    const navigation = TestBed.inject(RouteNavigationService);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const record = component.records().find((r) => r.kind === 'distance')!;
    component.openActivity(record.activity);

    expect(navigate).toHaveBeenCalledWith(['/activity', 1]);
    // Newest first, like the history's own default order.
    expect(navigation.sequence()).toEqual([3, 2, 1]);
    expect(navigation.label()).toBe('All');
  });

  it('should remember the period and the tab for the next visit', async () => {
    component.setTab(1);
    component.setPeriod('week');
    component.setMetric('climb');

    await create();

    expect(component.activeTab()).toBe(1);
    expect(component.period()).toBe('week');
    expect(component.metric()).toBe('climb');
  });

  it('should fall back to every route when the remembered collection is gone', async () => {
    component.setTab(1);
    mockDatabaseService.getCollections.mockResolvedValue([]);

    await create();

    expect(component.activeTab()).toBe('all');
  });
});
