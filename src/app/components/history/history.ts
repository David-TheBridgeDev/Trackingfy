import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { Activity, Collection, Coordinate, DatabaseService } from '../../services/database';
import {
  COLLECTION_COLORS,
  COLLECTION_NAME_MAX,
  CollectionFilter,
  CollectionsService,
  parseCollectionFilter,
} from '../../services/collections';
import { RouteNavigationService } from '../../services/route-navigation';
import { UIService } from '../../services/ui';
import { TranslationService } from '../../services/translation';
import { CollectionPickerComponent } from '../collection-picker/collection-picker';

export type { CollectionFilter };

export type SortField = 'date' | 'distance' | 'duration' | 'climb' | 'descent' | 'name';

interface DayGroup {
  /** The day these activities share, or null when the list is not grouped by day. */
  date: string | null;
  activities: Activity[];
}

/** An activity with the text a search is matched against, built once per list change. */
interface IndexedActivity {
  activity: Activity;
  haystack: string;
}

const TAB_STORAGE_KEY = 'trackingfy_history_tab';

/** Long enough not to fire while scrolling, short enough to feel like a press. */
const LONG_PRESS_MS = 450;
/** A press that travels further than this is a scroll, not a press. */
const LONG_PRESS_TOLERANCE_PX = 12;
/**
 * How long a long press keeps swallowing clicks.
 *
 * The click that ends the press has to be ignored, but a press may also raise a context
 * menu and then no click at all, so the guard expires by itself rather than waiting for
 * a click that might never come and eating the next real tap.
 */
const CLICK_SUPPRESSION_MS = 700;

/** Accent- and case-insensitive, so "montaña" is found by typing "montana". */
export function normalizeForSearch(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * The history: every recorded route, and the tools to find one again.
 *
 * Once someone has a few hundred routes, a single list sorted by date is unusable, so
 * the routes are filed under collections the user creates — shown as tabs — and narrowed
 * further by a search over name, type and date. Everything that acts on more than one
 * route (moving between collections, deleting) goes through the same selection mode, and
 * a deletion can be taken back from the toast it raises.
 */
@Component({
  selector: 'app-history',
  imports: [CommonModule, FormsModule, CollectionPickerComponent],
  templateUrl: './history.html',
  styleUrl: './history.css',
})
export class HistoryComponent implements OnInit {
  private db = inject(DatabaseService);
  private router = inject(Router);
  private collectionsService = inject(CollectionsService);
  private routeNavigation = inject(RouteNavigationService);
  public uiService = inject(UIService);
  public ts = inject(TranslationService);

  activities = signal<Activity[]>([]);
  collections = this.collectionsService.collections;

  readonly colors = COLLECTION_COLORS;

  // Tabs, search and sorting
  activeTab = signal<CollectionFilter>(readStoredTab());
  search = signal('');
  typeFilter = signal<string>('all');
  showFilters = signal(false);
  sortBy = signal<SortField>('date');
  sortOrder = signal<'asc' | 'desc'>('desc');

  // Selection
  isSelectionMode = signal(false);
  selectedIds = signal<Set<number>>(new Set());

  // Sheets
  showMovePicker = signal(false);
  showManager = signal(false);

  /** The reload in flight, if any, so two callers do not read the database twice. */
  private refreshing?: Promise<void>;

  private pressTimer?: ReturnType<typeof setTimeout>;
  private pressOrigin = { x: 0, y: 0 };
  /** Until when a long press keeps the click it produces from opening the route. */
  private suppressClickUntil = 0;

  readonly tabCounts = computed(() => this.collectionsService.countRoutes(this.activities()));

  readonly tabs = computed(() =>
    this.collectionsService.buildTabs(this.activities(), {
      all: this.ts.t('collections.all'),
      none: this.ts.t('collections.none'),
    }),
  );

  /** The activity types actually present, so the filter never offers an empty one. */
  readonly typeOptions = computed(() => {
    const types = new Set<string>();
    for (const activity of this.activities()) types.add(activity.type);
    return Array.from(types).sort((a, b) => this.typeLabel(a).localeCompare(this.typeLabel(b)));
  });

  /**
   * The text each activity is searched by.
   *
   * Built apart from the query so that typing filters an index that is already there,
   * instead of reformatting every date on every keystroke.
   */
  private readonly searchIndex = computed<IndexedActivity[]>(() => {
    const locale = this.ts.currentLang() === 'es' ? 'es-ES' : 'en-GB';
    const byId = this.collectionsService.byId();

    return this.activities().map((activity) => {
      const date = new Date(activity.date);
      const collection = activity.collectionId ? byId.get(activity.collectionId) : undefined;

      // Both spellings of the date: the one in the chosen language, and the one the
      // list itself prints, which comes from Angular's default locale.
      const dates = new Set([
        date.toLocaleDateString(locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        date.toLocaleDateString(locale),
        date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
      ]);

      const parts = [
        activity.name ?? '',
        activity.type,
        this.typeLabel(activity.type),
        collection?.name ?? '',
        ...dates,
        `${(activity.totalDistance / 1000).toFixed(2)} km`,
      ];

      return { activity, haystack: normalizeForSearch(parts.join(' ')) };
    });
  });

  readonly filteredActivities = computed(() => {
    const tab = this.activeTab();
    const type = this.typeFilter();
    const tokens = normalizeForSearch(this.search().trim()).split(/\s+/).filter(Boolean);

    const result = this.searchIndex()
      .filter(({ activity }) => this.collectionsService.matches(activity, tab))
      .filter(({ activity }) => type === 'all' || activity.type === type)
      // Every word has to match somewhere, so "monte 2025" narrows instead of widening.
      .filter(({ haystack }) => tokens.every((token) => haystack.includes(token)))
      .map(({ activity }) => activity);

    const order = this.sortOrder() === 'asc' ? 1 : -1;
    const field = this.sortBy();

    return result.sort((a, b) => {
      switch (field) {
        case 'date':
          return (new Date(a.date).getTime() - new Date(b.date).getTime()) * order;
        case 'distance':
          return (a.totalDistance - b.totalDistance) * order;
        case 'duration':
          return (a.totalTime - b.totalTime) * order;
        case 'climb':
          return (a.totalClimb - b.totalClimb) * order;
        case 'descent':
          return (a.totalDescent - b.totalDescent) * order;
        case 'name':
          return this.displayName(a).localeCompare(this.displayName(b)) * order;
        default:
          return 0;
      }
    });
  });

  /**
   * The list as it is drawn: day by day when sorted by date, flat otherwise.
   *
   * Day separators only mean something while the list runs in date order; under any
   * other sort they would cut the ranking into one-row groups.
   */
  readonly groupedActivities = computed<DayGroup[]>(() => {
    const activities = this.filteredActivities();
    if (this.sortBy() !== 'date') {
      return activities.length === 0 ? [] : [{ date: null, activities }];
    }

    const groups: DayGroup[] = [];
    for (const activity of activities) {
      const dateStr = new Date(activity.date).toDateString();
      let group = groups.find((g) => g.date === dateStr);
      if (!group) {
        group = { date: dateStr, activities: [] };
        groups.push(group);
      }
      group.activities.push(activity);
    }
    return groups;
  });

  readonly summary = computed(() => {
    const activities = this.filteredActivities();
    const distance = activities.reduce((total, a) => total + a.totalDistance, 0) / 1000;
    const params = { count: activities.length, distance: distance.toFixed(1) };
    return activities.length === 1
      ? this.ts.t('history.summary_one', params)
      : this.ts.t('history.summary', params);
  });

  readonly hasActiveFilters = computed(
    () =>
      this.search().trim() !== '' ||
      this.typeFilter() !== 'all' ||
      this.sortBy() !== 'date' ||
      this.sortOrder() !== 'desc',
  );

  readonly visibleIds = computed(() =>
    this.filteredActivities()
      .map((a) => a.id)
      .filter((id): id is number => id !== undefined),
  );

  readonly allVisibleSelected = computed(() => {
    const visible = this.visibleIds();
    const selected = this.selectedIds();
    return visible.length > 0 && visible.every((id) => selected.has(id));
  });

  /** The collection the current selection is in, when they all share one. */
  readonly selectionCollectionId = computed<number | null>(() => {
    const selected = this.selectedIds();
    const keys = new Set(
      this.activities()
        .filter((a) => a.id !== undefined && selected.has(a.id))
        .map((a) => this.collectionsService.keyOf(a)),
    );

    if (keys.size !== 1) return null;
    const [key] = keys;
    return key === 'none' ? null : key;
  });

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        if (event.urlAfterRedirects === '/history' || event.url === '/history') {
          this.uiService.setFullScreen(false);
          // This screen is kept alive between visits, so what happened elsewhere -- a
          // route renamed, refiled or deleted from its detail view -- has to be picked
          // up on the way back in, or the list shows a past that no longer exists.
          void this.refresh();
        }
      });
  }

  async ngOnInit() {
    this.uiService.setFullScreen(false);
    await this.refresh();
    if (this.uiService.historyScrollTop > 0) {
      const targetScroll = this.uiService.historyScrollTop;
      const restore = () => {
        const container = document.getElementById('main-scroll-container');
        if (container) {
          container.scrollTop = targetScroll;
        }
      };
      requestAnimationFrame(() => {
        restore();
        setTimeout(restore, 50);
      });
    }
  }

  /**
   * Reload the routes and the collections.
   *
   * Arriving at the history runs both `ngOnInit` and the navigation handler, so a
   * refresh already under way is joined rather than started a second time.
   */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;

    this.refreshing = (async () => {
      await Promise.all([this.loadActivities(), this.collectionsService.load()]);
      this.ensureValidTab();
    })().finally(() => {
      this.refreshing = undefined;
    });

    return this.refreshing;
  }

  async loadActivities() {
    const allActivities = await this.db.getActivities();
    this.activities.set(allActivities.filter((a) => a.endTime !== undefined));

    // A selection can outlive the routes it pointed at, once they are deleted elsewhere.
    const alive = new Set(this.activities().map((a) => a.id));
    this.selectedIds.update((set) => new Set([...set].filter((id) => alive.has(id))));
    if (this.selectedIds().size === 0) this.isSelectionMode.set(false);
  }

  /** Fall back to "all" when the open tab's collection is gone. */
  private ensureValidTab() {
    const tab = this.activeTab();
    if (typeof tab === 'number' && !this.collectionsService.byId().has(tab)) {
      this.setTab('all');
    }
  }

  // --- Tabs ----------------------------------------------------------------

  setTab(key: CollectionFilter) {
    this.activeTab.set(key);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, String(key));
    } catch {
      // Private browsing can refuse storage; the tab simply will not be remembered.
    }
  }

  isActiveTab(key: CollectionFilter): boolean {
    return this.activeTab() === key;
  }

  // --- Filters -------------------------------------------------------------

  onSearchInput(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }

  clearSearch() {
    this.search.set('');
  }

  toggleFilters() {
    this.showFilters.update((v) => !v);
  }

  setTypeFilter(type: string) {
    this.typeFilter.set(type);
  }

  clearFilters() {
    this.search.set('');
    this.typeFilter.set('all');
    this.sortBy.set('date');
    this.sortOrder.set('desc');
  }

  toggleSortOrder() {
    this.sortOrder.update((o) => (o === 'asc' ? 'desc' : 'asc'));
  }

  // --- Selection -----------------------------------------------------------

  enterSelectionMode(id?: number) {
    this.isSelectionMode.set(true);
    if (id !== undefined) {
      this.selectedIds.update((set) => {
        const newSet = new Set(set);
        newSet.add(id);
        return newSet;
      });
    }
  }

  exitSelectionMode() {
    this.isSelectionMode.set(false);
    this.selectedIds.set(new Set());
  }

  toggleSelection(id: number | undefined, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (id === undefined) return;

    this.selectedIds.update((set) => {
      const newSet = new Set(set);
      if (newSet.has(id)) {
        newSet.delete(id);
        if (newSet.size === 0) {
          this.isSelectionMode.set(false);
        }
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  isSelected(id: number | undefined): boolean {
    return id !== undefined && this.selectedIds().has(id);
  }

  /**
   * Take in, or drop, every route the current tab and filters show.
   *
   * It deliberately stops at what is on screen: "select all" while a collection is open
   * has to mean that collection, or it becomes a way to delete the whole history by
   * accident.
   */
  toggleSelectAllVisible() {
    if (this.allVisibleSelected()) {
      this.selectedIds.set(new Set());
      return;
    }

    this.selectedIds.set(new Set(this.visibleIds()));
    if (this.selectedIds().size > 0) this.isSelectionMode.set(true);
  }

  // --- Long press ----------------------------------------------------------

  onPressStart(event: PointerEvent, id: number | undefined) {
    if (id === undefined) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    this.pressOrigin = { x: event.clientX, y: event.clientY };
    this.cancelPress();
    this.pressTimer = setTimeout(() => {
      this.pressTimer = undefined;
      this.handleLongPress(id);
    }, LONG_PRESS_MS);
  }

  onPressMove(event: PointerEvent) {
    if (!this.pressTimer) return;

    const travelled =
      Math.abs(event.clientX - this.pressOrigin.x) + Math.abs(event.clientY - this.pressOrigin.y);
    if (travelled > LONG_PRESS_TOLERANCE_PX) this.cancelPress();
  }

  onPressEnd() {
    this.cancelPress();
  }

  private cancelPress() {
    if (this.pressTimer) {
      clearTimeout(this.pressTimer);
      this.pressTimer = undefined;
    }
  }

  private handleLongPress(id: number) {
    this.suppressClickUntil = Date.now() + CLICK_SUPPRESSION_MS;
    if ('vibrate' in navigator) navigator.vibrate(50);

    if (this.isSelectionMode()) {
      this.toggleSelection(id);
    } else {
      this.enterSelectionMode(id);
    }
  }

  /**
   * Right-click on a desktop is the same intent as holding a finger down.
   *
   * A finger held down on Android raises this too, right around the moment the press
   * timer fires; the suppression window says the press was already dealt with, so the
   * selection is not made and then immediately undone.
   */
  onContextMenu(event: Event, id: number | undefined) {
    event.preventDefault();
    if (id === undefined || Date.now() < this.suppressClickUntil) return;

    this.cancelPress();
    this.handleLongPress(id);
  }

  navigateToActivity(id: number | undefined) {
    if (Date.now() < this.suppressClickUntil) {
      this.suppressClickUntil = 0;
      return;
    }
    if (!id) return;

    if (this.isSelectionMode()) {
      this.toggleSelection(id);
      return;
    }

    const container = document.getElementById('main-scroll-container');
    if (container) {
      this.uiService.historyScrollTop = container.scrollTop;
    }

    // The detail view walks between routes with a swipe, and the order it walks is the
    // one on screen right now: this tab, this search, this sort. Handing it over on the
    // way out is what makes "the next route" mean the next one in the list.
    this.routeNavigation.setSequence(this.visibleIds(), this.activeTabLabel());

    this.router.navigate(['/activity', id]);
  }

  /** The name of the open tab, which is what the detail view calls the sequence. */
  private activeTabLabel(): string | null {
    const active = this.activeTab();
    return this.tabs().find((tab) => tab.key === active)?.label ?? null;
  }

  // --- Moving between collections ------------------------------------------

  openMovePicker() {
    if (this.selectedIds().size === 0) return;
    this.showMovePicker.set(true);
  }

  async moveSelectedTo(collectionId: number | null) {
    const ids = Array.from(this.selectedIds());
    this.showMovePicker.set(false);
    if (ids.length === 0) return;

    await this.collectionsService.assign(ids, collectionId ?? undefined);
    await this.refresh();
    this.exitSelectionMode();

    const name = this.collectionsService.nameOf(collectionId ?? undefined);
    if (name) {
      this.uiService.showToast(
        ids.length === 1
          ? this.ts.t('history.moved_one', { name })
          : this.ts.t('history.moved', { count: ids.length, name }),
      );
    } else {
      this.uiService.showToast(
        ids.length === 1
          ? this.ts.t('history.moved_out_one')
          : this.ts.t('history.moved_out', { count: ids.length }),
      );
    }
  }

  // --- Renaming ------------------------------------------------------------

  async renameSelected() {
    const ids = Array.from(this.selectedIds());
    if (ids.length !== 1) return;

    const activity = this.activities().find((a) => a.id === ids[0]);
    if (!activity) return;

    const renamed = await this.renameActivity(activity);
    if (renamed) this.exitSelectionMode();
  }

  private async renameActivity(activity: Activity): Promise<boolean> {
    const name = await this.uiService.prompt({
      title: this.ts.t('activity.rename.title'),
      message: this.ts.t('activity.rename.message'),
      placeholder: this.ts.t('activity.rename.placeholder'),
      value: activity.name ?? '',
      maxLength: 40,
    });
    if (!name || activity.id === undefined) return false;

    await this.db.updateActivity(activity.id, { name });
    await this.loadActivities();
    this.uiService.showToast(this.ts.t('history.renamed'));
    return true;
  }

  // --- Deleting ------------------------------------------------------------

  async deleteSelected() {
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) return;

    const single = ids.length === 1;
    const confirmed = await this.uiService.confirm({
      title: this.ts.t(single ? 'confirm.title.delete_single' : 'confirm.title.delete_multiple'),
      message: single
        ? this.ts.t('confirm.message.delete_single')
        : this.ts.t('confirm.message.delete_multiple', { count: ids.length }),
      confirmText: this.ts.t(single ? 'confirm.btn.delete' : 'confirm.btn.delete_all'),
      cancelText: this.ts.t('confirm.btn.cancel'),
      type: 'danger',
    });
    if (!confirmed) return;

    // The routes and their points are read before the delete so the toast can put them
    // back: a mis-tap on a route recorded months ago is otherwise unrecoverable.
    const removed = this.activities().filter((a) => a.id !== undefined && ids.includes(a.id));
    const coordinates = (
      await Promise.all(ids.map((id) => this.db.getCoordinates(id)))
    ).flat();

    await this.db.deleteActivities(ids);
    await this.loadActivities();
    this.exitSelectionMode();

    this.uiService.showToast(
      ids.length === 1
        ? this.ts.t('history.deleted_one')
        : this.ts.t('history.deleted', { count: ids.length }),
      {
        label: this.ts.t('history.undo'),
        run: () => void this.restoreActivities(removed, coordinates),
      },
    );
  }

  private async restoreActivities(activities: Activity[], coordinates: Coordinate[]) {
    await this.db.restoreActivities(activities, coordinates);
    await this.loadActivities();
    this.uiService.showToast(this.ts.t('history.restored'));
  }

  // --- Managing collections ------------------------------------------------

  openManager() {
    this.showManager.set(true);
  }

  closeManager() {
    this.showManager.set(false);
  }

  /** Create a collection and open it, so the next move has somewhere to go. */
  async createCollection() {
    const id = await this.promptForNewCollection();
    if (id !== null) this.setTab(id);
  }

  private async promptForNewCollection(): Promise<number | null> {
    const name = await this.uiService.prompt({
      title: this.ts.t('collections.create.title'),
      message: this.ts.t('collections.create.message'),
      placeholder: this.ts.t('collections.create.placeholder'),
      confirmText: this.ts.t('collections.create.confirm'),
      maxLength: COLLECTION_NAME_MAX,
    });
    if (!name) return null;

    const result = await this.collectionsService.create(name);
    if (result.kind === 'invalid') return null;

    this.uiService.showToast(
      result.kind === 'duplicate'
        ? this.ts.t('collections.duplicate')
        : this.ts.t('collections.created', { name: result.collection.name }),
    );

    return result.collection.id ?? null;
  }

  async renameCollection(collection: Collection) {
    if (collection.id === undefined) return;

    const name = await this.uiService.prompt({
      title: this.ts.t('collections.rename.title'),
      value: collection.name,
      placeholder: this.ts.t('collections.create.placeholder'),
      maxLength: COLLECTION_NAME_MAX,
    });
    if (!name) return;

    const renamed = await this.collectionsService.rename(collection.id, name);
    if (!renamed) this.uiService.showToast(this.ts.t('collections.duplicate'));
  }

  async setCollectionColor(collection: Collection, color: string) {
    if (collection.id === undefined) return;
    await this.collectionsService.setColor(collection.id, color);
  }

  async moveCollection(collection: Collection, direction: -1 | 1) {
    if (collection.id === undefined) return;
    await this.collectionsService.move(collection.id, direction);
  }

  async deleteCollection(collection: Collection) {
    if (collection.id === undefined) return;

    const confirmed = await this.uiService.confirm({
      title: this.ts.t('collections.delete.title'),
      message: this.ts.t('collections.delete.message', { name: collection.name }),
      confirmText: this.ts.t('collections.delete.confirm'),
      cancelText: this.ts.t('confirm.btn.cancel'),
      type: 'danger',
    });
    if (!confirmed) return;

    await this.collectionsService.remove(collection.id);
    if (this.activeTab() === collection.id) this.setTab('all');
    await this.loadActivities();
    this.uiService.showToast(this.ts.t('collections.deleted'));
  }

  collectionCount(collection: Collection): number {
    return collection.id === undefined ? 0 : (this.tabCounts().counts.get(collection.id) ?? 0);
  }

  isFirstCollection(collection: Collection): boolean {
    return this.collections()[0]?.id === collection.id;
  }

  isLastCollection(collection: Collection): boolean {
    return this.collections()[this.collections().length - 1]?.id === collection.id;
  }

  // --- Presentation --------------------------------------------------------

  /** What a route is called in the list: its name, or the activity it was. */
  displayName(activity: Activity): string {
    return activity.name?.trim() || this.typeLabel(activity.type);
  }

  typeLabel(type: string): string {
    const label = this.ts.t(`activity.${type}`);
    return label === `activity.${type}` ? type : label;
  }

  /** Only two route icons exist, so anything on foot shares the walking one. */
  typeIcon(type: string): string {
    return type === 'Cycling' ? 'icons/bike.svg' : 'icons/walking.svg';
  }

  collectionOf(activity: Activity): Collection | null {
    const key = this.collectionsService.keyOf(activity);
    return key === 'none' ? null : (this.collectionsService.get(key) ?? null);
  }

  goToDashboard() {
    this.router.navigate(['/dashboard']);
  }

  goToStats() {
    this.router.navigate(['/stats']);
  }

  formatTime(seconds: number): string {
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
  }
}

/** The tab the user left the history on, so the app opens where they were. */
function readStoredTab(): CollectionFilter {
  try {
    return parseCollectionFilter(localStorage.getItem(TAB_STORAGE_KEY));
  } catch {
    // Private browsing can refuse storage; the history simply opens on "all".
    return 'all';
  }
}
