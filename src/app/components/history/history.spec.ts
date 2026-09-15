import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Activity, Collection, DatabaseService } from '../../services/database';
import { TranslationService } from '../../services/translation';
import { UIService } from '../../services/ui';
import { HistoryComponent } from './history';

function makeActivity(overrides: Partial<Activity> & { id: number }): Activity {
  const start = overrides.startTime ?? Date.now() - 3600000;
  return {
    date: new Date(start),
    type: 'Cycling',
    totalDistance: 10000,
    totalTime: 3600,
    avgSpeed: 2.7,
    totalClimb: 100,
    totalDescent: 100,
    startTime: start,
    endTime: start + 3600000,
    ...overrides,
  };
}

function makeCollection(id: number, name: string, order = 0): Collection {
  return { id, name, color: '#efbc21', order, createdAt: 1 };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('HistoryComponent', () => {
  let component: HistoryComponent;
  let fixture: ComponentFixture<HistoryComponent>;
  let uiService: UIService;
  let translation: TranslationService;
  let router: Router;

  const mockDatabaseService = {
    getActivities: vi.fn(),
    getCollections: vi.fn(),
    getCoordinates: vi.fn(),
    deleteActivities: vi.fn(),
    restoreActivities: vi.fn(),
    updateActivity: vi.fn(),
    assignCollection: vi.fn(),
    addCollection: vi.fn(),
    updateCollection: vi.fn(),
    deleteCollection: vi.fn(),
    saveCollectionOrder: vi.fn(),
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();

    mockDatabaseService.getActivities.mockResolvedValue([]);
    mockDatabaseService.getCollections.mockResolvedValue([]);
    mockDatabaseService.getCoordinates.mockResolvedValue([]);
    mockDatabaseService.deleteActivities.mockResolvedValue(undefined);
    mockDatabaseService.restoreActivities.mockResolvedValue(undefined);
    mockDatabaseService.updateActivity.mockResolvedValue(1);
    mockDatabaseService.assignCollection.mockResolvedValue(undefined);
    mockDatabaseService.addCollection.mockResolvedValue(9);
    mockDatabaseService.deleteCollection.mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [HistoryComponent],
      providers: [provideRouter([]), { provide: DatabaseService, useValue: mockDatabaseService }],
    }).compileComponents();

    fixture = TestBed.createComponent(HistoryComponent);
    component = fixture.componentInstance;
    uiService = TestBed.inject(UIService);
    translation = TestBed.inject(TranslationService);
    router = TestBed.inject(Router);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should filter out activities that do not have an endTime', async () => {
    mockDatabaseService.getActivities.mockResolvedValue([
      makeActivity({ id: 1 }),
      { ...makeActivity({ id: 2 }), endTime: undefined },
    ]);

    await component.loadActivities();

    expect(component.activities().length).toBe(1);
    expect(component.activities()[0].id).toBe(1);
  });

  describe('collections', () => {
    beforeEach(async () => {
      mockDatabaseService.getCollections.mockResolvedValue([
        makeCollection(1, 'Monte', 0),
        makeCollection(2, 'Caminata', 1),
      ]);
      // Distinct start times: the default sort is by date, and routes recorded in the
      // same millisecond would come back in whichever order the sort happened to leave.
      const now = Date.now();
      mockDatabaseService.getActivities.mockResolvedValue([
        makeActivity({ id: 10, collectionId: 1, startTime: now }),
        makeActivity({ id: 11, collectionId: 1, startTime: now - 3600000 }),
        makeActivity({ id: 12, collectionId: 2, startTime: now - 7200000 }),
        makeActivity({ id: 13, startTime: now - 10800000 }),
      ]);
      await component.refresh();
    });

    it('should offer a tab per collection, plus all and the ungrouped leftovers', () => {
      const tabs = component.tabs();

      expect(tabs.map((tab) => tab.key)).toEqual(['all', 1, 2, 'none']);
      expect(tabs[0].count).toBe(4);
      expect(tabs[1].count).toBe(2);
      expect(tabs[3].count).toBe(1);
    });

    it('should show only the routes of the open tab', () => {
      component.setTab(1);
      expect(component.filteredActivities().map((a) => a.id)).toEqual([10, 11]);

      component.setTab('none');
      expect(component.filteredActivities().map((a) => a.id)).toEqual([13]);
    });

    it('should treat a route filed under a missing collection as ungrouped', async () => {
      mockDatabaseService.getActivities.mockResolvedValue([
        makeActivity({ id: 20, collectionId: 404 }),
      ]);
      await component.refresh();

      expect(component.tabCounts().ungrouped).toBe(1);
      component.setTab('none');
      expect(component.filteredActivities().map((a) => a.id)).toEqual([20]);
    });

    it('should hide the ungrouped tab once every route is filed', async () => {
      mockDatabaseService.getActivities.mockResolvedValue([
        makeActivity({ id: 10, collectionId: 1 }),
      ]);
      await component.refresh();

      expect(component.tabs().map((tab) => tab.key)).toEqual(['all', 1, 2]);
    });

    it('should fall back to all when the open tab no longer exists', async () => {
      component.setTab(2);
      mockDatabaseService.getCollections.mockResolvedValue([makeCollection(1, 'Monte', 0)]);

      await component.refresh();

      expect(component.activeTab()).toBe('all');
    });

    it('should move the selection into a collection and leave selection mode', async () => {
      component.enterSelectionMode(13);
      await component.moveSelectedTo(2);

      expect(mockDatabaseService.assignCollection).toHaveBeenCalledWith([13], 2);
      expect(component.isSelectionMode()).toBe(false);
    });

    it('should take the selection out of every collection', async () => {
      component.enterSelectionMode(10);
      await component.moveSelectedTo(null);

      expect(mockDatabaseService.assignCollection).toHaveBeenCalledWith([10], undefined);
    });

    it('should delete a collection after confirmation and reopen the all tab', async () => {
      vi.spyOn(uiService, 'confirm').mockResolvedValue(true);
      component.setTab(1);

      await component.deleteCollection(makeCollection(1, 'Monte'));

      expect(mockDatabaseService.deleteCollection).toHaveBeenCalledWith(1);
      expect(component.activeTab()).toBe('all');
    });

    it('should keep a collection when the deletion is not confirmed', async () => {
      vi.spyOn(uiService, 'confirm').mockResolvedValue(false);

      await component.deleteCollection(makeCollection(1, 'Monte'));

      expect(mockDatabaseService.deleteCollection).not.toHaveBeenCalled();
    });
  });

  describe('search and filters', () => {
    beforeEach(async () => {
      const day = new Date('2025-03-08T10:00:00').getTime();
      mockDatabaseService.getCollections.mockResolvedValue([makeCollection(1, 'Montaña', 0)]);
      mockDatabaseService.getActivities.mockResolvedValue([
        makeActivity({ id: 1, name: 'Subida al Peñón', collectionId: 1, startTime: day }),
        makeActivity({ id: 2, type: 'Walking', totalDistance: 4000, startTime: day - 86400000 }),
        makeActivity({ id: 3, type: 'Running', totalDistance: 21000, startTime: day - 172800000 }),
      ]);
      await component.refresh();
    });

    it('should match a route name ignoring case and accents', () => {
      component.search.set('penon');
      expect(component.filteredActivities().map((a) => a.id)).toEqual([1]);
    });

    it('should match the activity type', () => {
      component.search.set('walking');
      expect(component.filteredActivities().map((a) => a.id)).toEqual([2]);
    });

    it('should match the date as the list spells it', () => {
      // The list prints dates through Angular's default locale whatever the chosen
      // language, so both spellings have to find the route: all three are from March,
      // only one is from the 8th.
      component.search.set('march 8');
      expect(component.filteredActivities().map((a) => a.id)).toEqual([1]);

      translation.setLanguage('es');
      component.search.set('marzo 8');
      expect(component.filteredActivities().map((a) => a.id)).toEqual([1]);

      component.search.set('march 8');
      expect(component.filteredActivities().map((a) => a.id)).toEqual([1]);
    });

    it('should match the collection name', () => {
      component.search.set('montana');
      expect(component.filteredActivities().map((a) => a.id)).toEqual([1]);
    });

    it('should require every word of the query to match', () => {
      component.search.set('subida walking');
      expect(component.filteredActivities()).toEqual([]);
    });

    it('should narrow by activity type', () => {
      component.setTypeFilter('Running');
      expect(component.filteredActivities().map((a) => a.id)).toEqual([3]);
    });

    it('should sort by distance', () => {
      component.sortBy.set('distance');
      component.sortOrder.set('asc');
      expect(component.filteredActivities().map((a) => a.id)).toEqual([2, 1, 3]);
    });

    it('should group by day only while sorted by date', () => {
      expect(component.groupedActivities().length).toBe(3);

      component.sortBy.set('distance');
      const groups = component.groupedActivities();
      expect(groups.length).toBe(1);
      expect(groups[0].date).toBeNull();
    });

    it('should report filters as active only once something is set', () => {
      expect(component.hasActiveFilters()).toBe(false);
      component.search.set('monte');
      expect(component.hasActiveFilters()).toBe(true);
      component.clearFilters();
      expect(component.hasActiveFilters()).toBe(false);
    });
  });

  describe('selection', () => {
    beforeEach(async () => {
      const now = Date.now();
      mockDatabaseService.getActivities.mockResolvedValue([
        makeActivity({ id: 1, type: 'Cycling', startTime: now }),
        makeActivity({ id: 2, type: 'Walking', startTime: now - 3600000 }),
        makeActivity({ id: 3, type: 'Walking', startTime: now - 7200000 }),
      ]);
      await component.refresh();
    });

    it('should enter selection mode and select an activity', () => {
      component.enterSelectionMode(1);
      expect(component.isSelectionMode()).toBe(true);
      expect(component.selectedIds().has(1)).toBe(true);
    });

    it('should toggle selection and exit mode when no items are selected', () => {
      component.enterSelectionMode(1);
      component.toggleSelection(1);
      expect(component.isSelectionMode()).toBe(false);
      expect(component.selectedIds().size).toBe(0);
    });

    it('should select all items and then exit selection mode', () => {
      component.enterSelectionMode(1);
      component.toggleSelection(2);
      expect(component.selectedIds().size).toBe(2);
      component.exitSelectionMode();
      expect(component.isSelectionMode()).toBe(false);
      expect(component.selectedIds().size).toBe(0);
    });

    it('should select every route the filters leave on screen, and no more', () => {
      component.setTypeFilter('Walking');
      component.toggleSelectAllVisible();

      expect(Array.from(component.selectedIds())).toEqual([2, 3]);
      expect(component.isSelectionMode()).toBe(true);

      component.toggleSelectAllVisible();
      expect(component.selectedIds().size).toBe(0);
    });

    it('should drop from the selection routes that no longer exist', async () => {
      component.enterSelectionMode(3);
      mockDatabaseService.getActivities.mockResolvedValue([makeActivity({ id: 1 })]);

      await component.loadActivities();

      expect(component.selectedIds().size).toBe(0);
      expect(component.isSelectionMode()).toBe(false);
    });

    it('should open selection mode on a long press instead of opening the route', () => {
      vi.useFakeTimers();
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      component.onPressStart({ pointerType: 'touch', clientX: 0, clientY: 0 } as PointerEvent, 1);
      vi.advanceTimersByTime(500);

      expect(component.isSelectionMode()).toBe(true);
      expect(component.selectedIds().has(1)).toBe(true);

      // The browser fires the click that ended the press right after it.
      component.navigateToActivity(1);
      expect(navigate).not.toHaveBeenCalled();
      expect(component.selectedIds().has(1)).toBe(true);

      vi.useRealTimers();
    });

    it('should ignore the context menu a long press raises on top of itself', () => {
      vi.useFakeTimers();

      component.onPressStart({ pointerType: 'touch', clientX: 0, clientY: 0 } as PointerEvent, 1);
      vi.advanceTimersByTime(500);
      component.onContextMenu(new Event('contextmenu'), 1);

      expect(component.selectedIds().has(1)).toBe(true);
      vi.useRealTimers();
    });

    it('should not start a selection when the press turns into a scroll', () => {
      vi.useFakeTimers();

      component.onPressStart({ pointerType: 'touch', clientX: 0, clientY: 0 } as PointerEvent, 1);
      component.onPressMove({ clientX: 0, clientY: 60 } as PointerEvent);
      vi.advanceTimersByTime(500);

      expect(component.isSelectionMode()).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('deleting', () => {
    beforeEach(async () => {
      const now = Date.now();
      mockDatabaseService.getActivities.mockResolvedValue([
        makeActivity({ id: 1, startTime: now }),
        makeActivity({ id: 2, startTime: now - 3600000 }),
      ]);
      mockDatabaseService.getCoordinates.mockResolvedValue([
        { id: 5, activityId: 1, lat: 1, lng: 1, timestamp: 1 },
      ]);
      await component.refresh();
    });

    it('should delete the selection once it is confirmed', async () => {
      vi.spyOn(uiService, 'confirm').mockResolvedValue(true);
      component.enterSelectionMode(1);

      await component.deleteSelected();

      expect(mockDatabaseService.deleteActivities).toHaveBeenCalledWith([1]);
      expect(component.isSelectionMode()).toBe(false);
    });

    it('should delete nothing when the confirmation is dismissed', async () => {
      vi.spyOn(uiService, 'confirm').mockResolvedValue(false);
      component.enterSelectionMode(1);

      await component.deleteSelected();

      expect(mockDatabaseService.deleteActivities).not.toHaveBeenCalled();
      expect(component.isSelectionMode()).toBe(true);
    });

    it('should put the routes and their points back when the toast is undone', async () => {
      vi.spyOn(uiService, 'confirm').mockResolvedValue(true);
      component.enterSelectionMode(1);
      component.toggleSelection(2);

      await component.deleteSelected();

      const toast = uiService.toast();
      expect(toast?.action).toBeTruthy();

      toast!.action!.run();
      await flush();

      const [activities, coordinates] = mockDatabaseService.restoreActivities.mock.calls[0];
      expect(activities.map((a: Activity) => a.id)).toEqual([1, 2]);
      expect(coordinates.length).toBe(2);
    });
  });

  it('should rename the only selected route', async () => {
    mockDatabaseService.getActivities.mockResolvedValue([makeActivity({ id: 1 })]);
    await component.refresh();
    vi.spyOn(uiService, 'prompt').mockResolvedValue('Ruta del faro');

    component.enterSelectionMode(1);
    await component.renameSelected();

    expect(mockDatabaseService.updateActivity).toHaveBeenCalledWith(1, { name: 'Ruta del faro' });
    expect(component.isSelectionMode()).toBe(false);
  });

  it('should show a route by its name, or by its type when it has none', async () => {
    const now = Date.now();
    mockDatabaseService.getActivities.mockResolvedValue([
      makeActivity({ id: 1, name: 'Ruta del faro', startTime: now }),
      makeActivity({ id: 2, type: 'Walking', startTime: now - 3600000 }),
    ]);
    await component.refresh();

    const [named, unnamed] = component.activities();
    expect(component.displayName(named)).toBe('Ruta del faro');
    expect(component.displayName(unnamed)).toBe(component.typeLabel('Walking'));
  });
});
