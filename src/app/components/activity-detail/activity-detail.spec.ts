import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Activity, Coordinate, DatabaseService } from '../../services/database';
import { RouteNavigationService } from '../../services/route-navigation';
import { TranslationService } from '../../services/translation';
import { App } from '../../app';
import { ActivityDetailComponent } from './activity-detail';

function makeActivity(id: number): Activity {
  const start = 1_700_000_000_000 + id * 1000;
  return {
    id,
    name: `Route ${id}`,
    date: new Date(start),
    type: 'Cycling',
    totalDistance: 10000,
    totalTime: 3600,
    avgSpeed: 2.7,
    totalClimb: 100,
    totalDescent: 100,
    startTime: start,
    endTime: start + 3600000,
  };
}

function makeCoordinate(activityId: number): Coordinate {
  return { activityId, lat: 40, lng: -3, timestamp: 1_700_000_000_000, altitude: 700 };
}

/** jsdom has no PointerEvent, and the handlers only read a handful of its fields. */
function pointer(x: number, y = 0, overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'touch',
    button: 0,
    target: null,
    ...overrides,
  } as unknown as PointerEvent;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ActivityDetailComponent', () => {
  let component: ActivityDetailComponent;
  let fixture: ComponentFixture<ActivityDetailComponent>;
  let navigation: RouteNavigationService;
  let paramMap: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigate: ReturnType<typeof vi.spyOn>;

  const mockDatabaseService = {
    getActivity: vi.fn(),
    getCoordinates: vi.fn(),
    getCollections: vi.fn(),
    getActivities: vi.fn(),
    deleteActivity: vi.fn(),
    updateActivity: vi.fn(),
  };

  /** Stand in for the router: the stub route is what actually swaps the id. */
  async function goTo(id: number) {
    paramMap.next(convertToParamMap({ id: String(id) }));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reduced motion takes the slide animation out of the way of the assertions; the
    // animated path gets a test of its own below.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() }),
    );

    mockDatabaseService.getActivity.mockImplementation(async (id: number) => makeActivity(id));
    mockDatabaseService.getCoordinates.mockImplementation(async (id: number) => [
      makeCoordinate(id),
    ]);
    mockDatabaseService.getCollections.mockResolvedValue([]);
    mockDatabaseService.getActivities.mockResolvedValue([makeActivity(1), makeActivity(2)]);
    mockDatabaseService.deleteActivity.mockResolvedValue(undefined);
    mockDatabaseService.updateActivity.mockResolvedValue(1);

    paramMap = new BehaviorSubject(convertToParamMap({ id: '2' }));

    await TestBed.configureTestingModule({
      imports: [ActivityDetailComponent],
      providers: [
        provideRouter([]),
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: ActivatedRoute, useValue: { paramMap } },
        { provide: App, useValue: { triggerToast: vi.fn() } },
      ],
    }).compileComponents();

    TestBed.inject(TranslationService).setLanguage('en');

    navigation = TestBed.inject(RouteNavigationService);
    navigation.setSequence([1, 2, 3], 'Monte');

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(ActivityDetailComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should show the route named in the URL', () => {
    expect(component.activity()?.id).toBe(2);
    expect(component.coordinates().length).toBe(1);
  });

  it('should load the next route when the URL changes under it', async () => {
    await goTo(3);

    expect(component.activity()?.id).toBe(3);
    expect(component.coordinates()[0].activityId).toBe(3);
  });

  it('should place the route inside the list it was opened from', () => {
    expect(component.hasGallery()).toBe(true);
    expect(component.position()).toMatchObject({ index: 1, total: 3, previousId: 1, nextId: 3 });
    expect(component.positionLabel()).toBe('2 of 3');
    expect(component.sequenceLabel()).toBe('Monte');
  });

  it('should hide the gallery when there is nowhere to walk to', async () => {
    navigation.setSequence([2]);
    await fixture.whenStable();

    expect(component.hasGallery()).toBe(false);
  });

  it('should walk to the next and previous route, replacing the URL rather than stacking it', async () => {
    component.goToNext();
    await flush();
    expect(navigate).toHaveBeenCalledWith(['/activity', 3], { replaceUrl: true });

    component.goToPrevious();
    await flush();
    expect(navigate).toHaveBeenCalledWith(['/activity', 1], { replaceUrl: true });
  });

  it('should not walk past either end of the list', async () => {
    await goTo(1);

    component.goToPrevious();
    await flush();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('should change route on a swipe that crosses the threshold', async () => {
    component.onSwipeStart(pointer(300));
    component.onSwipeMove(pointer(200));
    component.onSwipeEnd(pointer(200));
    await flush();

    expect(navigate).toHaveBeenCalledWith(['/activity', 3], { replaceUrl: true });
  });

  it('should spring back from a swipe that stops short', async () => {
    component.onSwipeStart(pointer(300));
    component.onSwipeMove(pointer(270));
    expect(component.swipeOffset()).toBeLessThan(0);

    component.onSwipeEnd(pointer(270));
    await flush();

    expect(navigate).not.toHaveBeenCalled();
    expect(component.swipeOffset()).toBe(0);
  });

  it('should leave a mostly vertical drag to the page it is scrolling', async () => {
    component.onSwipeStart(pointer(300, 100));
    component.onSwipeMove(pointer(230, 300));
    component.onSwipeEnd(pointer(230, 300));
    await flush();

    expect(component.swipeOffset()).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('should ignore a drag that starts on a button', async () => {
    const button = document.createElement('button');
    component.onSwipeStart(pointer(300, 0, { target: button }));
    component.onSwipeMove(pointer(200));
    component.onSwipeEnd(pointer(200));
    await flush();

    expect(component.swipeOffset()).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('should barely move when pulled past the end of the list', async () => {
    await goTo(3);

    component.onSwipeStart(pointer(300));
    component.onSwipeMove(pointer(200));

    // A hundred pixels of finger, a quarter of it on screen, and no route to land on.
    expect(component.swipeOffset()).toBe(-25);

    component.onSwipeEnd(pointer(200));
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('should let go of a drag that is cancelled mid-gesture', () => {
    component.onSwipeStart(pointer(300));
    component.onSwipeMove(pointer(220));
    component.onSwipeCancel();

    expect(component.swipeOffset()).toBe(0);
  });

  it('should walk with the arrow keys too', async () => {
    component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await flush();
    expect(navigate).toHaveBeenCalledWith(['/activity', 3], { replaceUrl: true });

    navigate.mockClear();
    component.isEditing.set(true);
    component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('should slide out and back when motion is allowed', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));

    component.goToNext();
    await flush();
    // Mid-animation: the card has been pushed towards the side the finger went.
    expect(component.swipeOffset()).toBeLessThan(0);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(navigate).toHaveBeenCalledWith(['/activity', 3], { replaceUrl: true });
    expect(component.swipeOffset()).toBe(0);
  });

  it('should fall back to the whole history when it was opened from nowhere', async () => {
    navigation.clear();

    await goTo(1);
    await fixture.whenStable();

    expect(mockDatabaseService.getActivities).toHaveBeenCalled();
    expect(navigation.sequence()).toEqual([1, 2]);
    expect(navigation.label()).toBe('History');
  });

  it('should forget the route it walked away from', async () => {
    component.hoveredCoordinate.set(makeCoordinate(2));
    component.isChoosingCollection.set(true);

    await goTo(3);

    expect(component.hoveredCoordinate()).toBeNull();
    expect(component.isChoosingCollection()).toBe(false);
  });

  it('should not let a slow load land on top of a newer one', async () => {
    // The first read is made to answer after the second, the way a fast walk through the
    // list would have them overlap.
    mockDatabaseService.getActivity.mockImplementation(
      (id: number) =>
        new Promise((resolve) => setTimeout(() => resolve(makeActivity(id)), id === 1 ? 40 : 0)),
    );

    const slow = goTo(1);
    const fast = goTo(3);
    await Promise.all([slow, fast]);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(component.activity()?.id).toBe(3);
    expect(component.coordinates()[0].activityId).toBe(3);
  });

  it('should show nothing for a route that is not there', async () => {
    mockDatabaseService.getActivity.mockResolvedValue(undefined);

    await goTo(404);

    expect(component.activity()).toBeNull();
    expect(component.coordinates()).toEqual([]);
    expect(component.chartPoints()).toEqual([]);
  });

  it('should re-file a route recorded under the wrong activity', async () => {
    component.isChoosingType.set(true);

    await component.changeType('Walking');

    expect(mockDatabaseService.updateActivity).toHaveBeenCalledWith(2, { type: 'Walking' });
    expect(component.activity()?.type).toBe('Walking');
    expect(component.typeLabel()).toBe('Walking');
    expect(component.typeIcon()).toContain('walking');
    expect(component.isChoosingType()).toBe(false);
  });

  it('should not write to the database when the activity is already that one', async () => {
    await component.changeType('Cycling');

    expect(mockDatabaseService.updateActivity).not.toHaveBeenCalled();
  });

  it('should take a deleted route out of the gallery', async () => {
    const confirm = vi.spyOn(component.uiService, 'confirm').mockResolvedValue(true);

    await component.deleteActivity();

    expect(confirm).toHaveBeenCalled();
    expect(mockDatabaseService.deleteActivity).toHaveBeenCalledWith(2);
    expect(navigation.sequence()).toEqual([1, 3]);
  });
});
