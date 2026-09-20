import { Component, HostListener, OnInit, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { DatabaseService, Activity, Coordinate } from '../../services/database';
import { CollectionsService } from '../../services/collections';
import { RouteNavigationService } from '../../services/route-navigation';
import { MapComponent } from '../map/map';
import { UIService } from '../../services/ui';
import { TrackingService } from '../../services/tracking';
import { TranslationService } from '../../services/translation';
import {
  RouteEditorService,
  DraftPoint,
  OpeningSegmentContext,
  resolveStartTime,
  splitManualOpening,
  toLocalInputValue,
} from '../../services/route-editor';
import { buildRouteExport } from '../../services/route-export';
import { fillAltitudeGaps } from '../../services/route-image';
import { haversine } from '../../services/route-stats';
import { App } from '../../app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { ShareComposerComponent } from '../share-composer/share-composer';
import { CollectionPickerComponent } from '../collection-picker/collection-picker';
import { ActivityTypePickerComponent } from '../activity-type-picker/activity-type-picker';
import { ActivityType, activityTypeIcon } from '../../services/activity-types';

/** A drag has to travel this far before it is a swipe rather than a tap. */
const SWIPE_INTENT_PX = 12;
/** And this far before letting go of it changes route. */
const SWIPE_COMMIT_PX = 60;
/** How much more horizontal than vertical a drag must be to count as a swipe. */
const SWIPE_DIRECTION_RATIO = 1.4;
/** How far the card can follow the finger. */
const SWIPE_MAX_PX = 110;
/** How far it slides out, and how long that takes, before the next route arrives. */
const SWIPE_EXIT_PX = 70;
const SWIPE_EXIT_MS = 140;
/** What is left of a route pulled towards an end of the list, where there is no next. */
const SWIPE_RESISTANCE = 0.25;

export interface ChartPoint {
  distance: number; // in km
  altitude: number;
  speed: number;    // in km/h
  x: number;        // percentage 0 to 100
  yAlt: number;     // percentage 0 to 100
  ySpeed: number;   // percentage 0 to 100
  coordinate: Coordinate;
}


@Component({
  selector: 'app-activity-detail',
  imports: [
    CommonModule,
    MapComponent,
    RouterLink,
    ShareComposerComponent,
    CollectionPickerComponent,
    ActivityTypePickerComponent,
  ],
  templateUrl: './activity-detail.html',
  styleUrl: './activity-detail.css',
})
export class ActivityDetailComponent implements OnInit {
  activity = signal<Activity | null>(null);
  coordinates = signal<Coordinate[]>([]);
  isSharingImage = signal(false);
  isExportingRoute = signal(false);
  isChoosingCollection = signal(false);
  isChoosingType = signal(false);

  svgViewBox = signal<string>('0 0 100 100');
  svgPath = signal<string>('');
  svgStrokeWidth = signal<number>(0.001);

  // Chart data
  chartPoints = signal<ChartPoint[]>([]);
  elevationPathChart = signal<string>('');
  elevationAreaPathChart = signal<string>('');
  speedPathChart = signal<string>('');
  hoveredPoint = signal<ChartPoint | null>(null);
  hoveredCoordinate = signal<Coordinate | null>(null);

  // Route editing: reconstructing a stretch that was never recorded
  isEditing = signal(false);
  isSavingEdit = signal(false);
  draftPoints = signal<DraftPoint[]>([]);
  startTimeInput = signal<string>('');
  startTimeTouched = signal(false);
  editError = signal<string | null>(null);

  /** The exact start time the saved segment carries, before the input rounds it down. */
  private seededStartTime = signal<number | null>(null);

  /** Snapshots of the draft before each change, so a mistaken tap can be taken back. */
  private draftHistory = signal<DraftPoint[][]>([]);
  canUndo = computed(() => this.draftHistory().length > 0);

  /** The saved hand-drawn opening and the recorded track, kept apart. */
  private segments = computed(() => splitManualOpening(this.coordinates()));

  /**
   * The recorded track alone. Editing always works against this: the anchor a drawn
   * segment joins is the first real fix, never a point drawn by a previous edit.
   */
  gpsCoordinates = computed(() => this.segments().gps);

  editContext = computed<OpeningSegmentContext | null>(() => {
    const activity = this.activity();
    if (!activity) return null;

    const { manual, gps } = this.segments();
    return { activity, gpsCoords: gps, existingManual: manual };
  });

  /** Distance of the drawn segment, available before a start time has been entered. */
  draftDistance = computed(() =>
    this.routeEditor.draftDistance(this.draftPoints(), this.gpsCoordinates()[0]),
  );

  /** Projected effect of the edit, recomputed on every change to the draft. */
  editPreview = computed(() => {
    const context = this.editContext();
    if (!context) return null;

    return this.routeEditor.previewOpeningSegment(
      context,
      this.draftPoints(),
      this.startTimeMs(),
    );
  });

  /** The projection when the draft is valid, so the template does not narrow a union. */
  editPreviewData = computed(() => {
    const validation = this.editPreview();
    return validation && validation.valid ? validation.preview : null;
  });

  /** Why the draft cannot be saved yet, if it cannot. */
  editValidationError = computed(() => {
    const validation = this.editPreview();
    if (!validation || validation.valid) return null;

    // An empty draft is where every edit starts, not a mistake to complain about.
    return validation.reason === 'no-points' ? null : validation.reason;
  });

  startTimeMs = computed<number | null>(() =>
    resolveStartTime(this.startTimeInput(), this.seededStartTime()),
  );

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private db: DatabaseService,
    private routeEditor: RouteEditorService,
    private collections: CollectionsService,
    private routeNavigation: RouteNavigationService,
    private appComponent: App,
    public uiService: UIService,
    public trackingService: TrackingService,
    public ts: TranslationService
  ) {
    // Walking to the next route reuses this screen rather than building a new one, so the
    // id has to be followed instead of read once on the way in.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      void this.open(Number(params.get('id')));
    });
  }

  async ngOnInit() {
    this.uiService.setFullScreen(false); // Reset FS when entering
    await this.collections.load();
  }

  /** The route whose load is in flight, if any. */
  private openingId?: number;

  /**
   * Show a route, from scratch: nothing of the previous one may survive the change.
   *
   * The id being loaded is remembered because walking quickly through a list starts a
   * read before the previous one has come back, and the slower answer must not be the
   * one that lands: a route's stats with another route's track would be worse than a
   * moment of the old one.
   */
  private async open(id: number) {
    this.openingId = id;
    this.resetView();

    if (!id) {
      this.activity.set(null);
      this.applyCoordinates([]);
      return;
    }

    const activity = await this.db.getActivity(id);
    const coordinates = activity ? await this.db.getCoordinates(id) : [];
    if (this.openingId !== id) return;

    this.activity.set(activity ?? null);
    this.applyCoordinates(coordinates);

    // Reached from somewhere that left no list behind -- a shared route, a reopened tab
    // -- the gallery falls back to the whole history rather than to nothing.
    if (activity) await this.routeNavigation.ensureContains(id, this.ts.t('app.history'));
  }


  /** Drop everything that belonged to the route being left behind. */
  private resetView() {
    this.cancelEdit();
    this.hoveredPoint.set(null);
    this.hoveredCoordinate.set(null);
    this.isSharingImage.set(false);
    this.isChoosingCollection.set(false);
    this.isExportingRoute.set(false);
  }

  // --- Walking between routes ----------------------------------------------

  /** Where this route sits in the list it was opened from. */
  position = computed(() => this.routeNavigation.neighbours(this.activity()?.id));

  /** The bar only earns its space once there is somewhere to walk to. */
  hasGallery = computed(() => this.position().index !== -1 && this.position().total > 1);

  positionLabel = computed(() =>
    this.ts.t('detail.gallery.position', {
      index: this.position().index + 1,
      total: this.position().total,
    }),
  );

  /** What the list being walked is called: the tab it came from, or the history. */
  sequenceLabel = computed(() => this.routeNavigation.label() ?? this.ts.t('app.history'));

  /** How far the card has been dragged sideways, in pixels. */
  swipeOffset = signal(0);

  /** Whether that offset is being animated rather than following a finger. */
  swipeSettling = signal(false);

  swipeTransform = computed(() => `translateX(${this.swipeOffset()}px)`);

  /** The card fades as it leaves, which is what makes the next one feel like a page. */
  swipeOpacity = computed(() =>
    Math.max(0.35, 1 - Math.abs(this.swipeOffset()) / (SWIPE_EXIT_PX * 2)),
  );

  private swipeStart: { x: number; y: number; pointerId: number } | null = null;
  /** Set once a drag has proved to be horizontal, so vertical scrolling is left alone. */
  private swipeLocked = false;
  /** While a change of route is playing, further gestures would fight the animation. */
  private isSliding = false;

  /**
   * Start following a drag across the route's header.
   *
   * Drags that begin on a button are left alone: a swipe that started on "delete" and
   * ended on another route would be a very expensive gesture to get wrong. The map and
   * the elevation chart are outside this surface entirely -- both already answer to
   * horizontal dragging, and taking that over would cost more than it gives.
   */
  onSwipeStart(event: PointerEvent) {
    if (!this.hasGallery() || this.isEditing() || this.isSliding) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea')) return;

    this.swipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    this.swipeLocked = false;
    this.swipeSettling.set(false);

    // Hold on to the pointer: a finger that wanders off the card mid-swipe would
    // otherwise stop reporting, leaving the card halfway to nowhere.
    const surface = event.currentTarget as HTMLElement | null;
    surface?.setPointerCapture?.(event.pointerId);
  }

  onSwipeMove(event: PointerEvent) {
    const start = this.swipeStart;
    if (!start || event.pointerId !== start.pointerId) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (!this.swipeLocked) {
      if (Math.abs(dx) < SWIPE_INTENT_PX) return;

      // A drag that is mostly vertical is someone scrolling the page; let go of it for
      // good rather than stealing the rest of the movement.
      if (Math.abs(dx) < Math.abs(dy) * SWIPE_DIRECTION_RATIO) {
        this.swipeStart = null;
        this.settle(0);
        return;
      }

      this.swipeLocked = true;
    }

    this.swipeOffset.set(this.resist(dx));
  }

  onSwipeEnd(event: PointerEvent) {
    const start = this.swipeStart;
    if (!start || event.pointerId !== start.pointerId) return;

    const dx = event.clientX - start.x;
    const locked = this.swipeLocked;

    this.swipeStart = null;
    this.swipeLocked = false;
    this.releasePointer(event);

    const direction: 1 | -1 = dx < 0 ? 1 : -1;
    if (locked && Math.abs(dx) >= SWIPE_COMMIT_PX && this.targetOf(direction) !== null) {
      void this.slide(direction);
    } else {
      this.settle(0);
    }
  }

  onSwipeCancel(event?: PointerEvent) {
    this.swipeStart = null;
    this.swipeLocked = false;
    if (event) this.releasePointer(event);
    this.settle(0);
  }

  private releasePointer(event: PointerEvent) {
    const surface = event.currentTarget as HTMLElement | null;
    if (surface?.hasPointerCapture?.(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId);
    }
  }

  goToPrevious() {
    void this.slide(-1);
  }

  goToNext() {
    void this.slide(1);
  }

  /** Arrow keys are the same gesture for anyone holding a keyboard instead of a phone. */
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (this.isEditing() || this.isSharingImage() || this.isChoosingCollection()) return;
    if (this.uiService.promptRequest() || this.uiService.confirmation()) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('input, select, textarea')) return;

    const direction: 1 | -1 = event.key === 'ArrowRight' ? 1 : -1;
    if (this.targetOf(direction) === null) return;

    event.preventDefault();
    void this.slide(direction);
  }

  /** The route a move in this direction lands on: forward is 1, back is -1. */
  private targetOf(direction: 1 | -1): number | null {
    const { previousId, nextId } = this.position();
    return direction === 1 ? nextId : previousId;
  }

  /** Follow the finger, unless there is nothing that way: then barely move at all. */
  private resist(dx: number): number {
    const capped = Math.max(-SWIPE_MAX_PX, Math.min(SWIPE_MAX_PX, dx));
    const target = this.targetOf(dx < 0 ? 1 : -1);
    return target === null ? capped * SWIPE_RESISTANCE : capped;
  }

  private settle(offset: number) {
    this.swipeSettling.set(true);
    this.swipeOffset.set(offset);
  }

  /**
   * Change route the way a gallery changes photo: the card leaves the way the finger
   * went, and the next one comes in from the other side.
   *
   * The navigation replaces the entry in the URL history instead of stacking onto it, so
   * back still means "out of the route", not "twelve routes back".
   */
  private async slide(direction: 1 | -1) {
    const id = this.targetOf(direction);
    if (id === null || this.isSliding) return;

    this.isSliding = true;

    try {
      if (!prefersReducedMotion()) {
        this.settle(-direction * SWIPE_EXIT_PX);
        await delay(SWIPE_EXIT_MS);

        // Put the card down on the far side without animating the jump, so the arrival
        // reads as a new card rather than as the old one sliding back.
        this.swipeSettling.set(false);
        this.swipeOffset.set(direction * SWIPE_EXIT_PX);
      }

      await this.router.navigate(['/activity', id], { replaceUrl: true });

      requestAnimationFrame(() => this.settle(0));
    } finally {
      this.isSliding = false;
    }
  }

  // --- Name and collection -------------------------------------------------

  /** The route's own name, or the activity it was when it has none. */
  displayName = computed(() => {
    const activity = this.activity();
    if (!activity) return '';

    const label = this.ts.t(`activity.${activity.type}`);
    return activity.name?.trim() || (label === `activity.${activity.type}` ? activity.type : label);
  });

  collection = computed(() => this.collections.get(this.activity()?.collectionId ?? undefined) ?? null);

  /** What the route is filed as, in the reader's language. */
  typeLabel = computed(() => {
    const type = this.activity()?.type ?? '';
    const label = this.ts.t(`activity.${type}`);
    return label === `activity.${type}` ? type : label;
  });

  typeIcon = computed(() => activityTypeIcon(this.activity()?.type ?? ''));

  /**
   * File the route as a different activity.
   *
   * Recording a walk with the dashboard left on "cycling" is an easy mistake and, until
   * this existed, a permanent one: the type feeds the history's filter, the statistics'
   * breakdown and the speed the route editor calls plausible, none of which could be put
   * right afterwards.
   */
  async changeType(type: ActivityType) {
    const activity = this.activity();
    this.isChoosingType.set(false);
    if (!activity?.id || activity.type === type) return;

    await this.db.updateActivity(activity.id, { type });
    this.activity.set({ ...activity, type });

    this.appComponent.triggerToast(
      this.ts.t('detail.type.changed', { type: this.ts.t(`activity.${type}`) }),
    );
  }

  async renameActivity() {
    const activity = this.activity();
    if (!activity?.id) return;

    const name = await this.uiService.prompt({
      title: this.ts.t('activity.rename.title'),
      message: this.ts.t('activity.rename.message'),
      placeholder: this.ts.t('activity.rename.placeholder'),
      value: activity.name ?? '',
      maxLength: 40,
    });
    if (!name) return;

    await this.db.updateActivity(activity.id, { name });
    this.activity.set({ ...activity, name });
    this.appComponent.triggerToast(this.ts.t('history.renamed'));
  }

  async changeCollection(collectionId: number | null) {
    const activity = this.activity();
    this.isChoosingCollection.set(false);
    if (!activity?.id) return;

    await this.collections.assign([activity.id], collectionId ?? undefined);

    const updated = { ...activity };
    if (collectionId === null) delete updated.collectionId;
    else updated.collectionId = collectionId;
    this.activity.set(updated);

    const name = this.collections.nameOf(collectionId ?? undefined);
    this.appComponent.triggerToast(
      name
        ? this.ts.t('history.moved_one', { name })
        : this.ts.t('history.moved_out_one'),
    );
  }

  /**
   * Delete the route being looked at.
   *
   * Until now a route could only be deleted from the history's selection mode, which
   * meant going back and hunting for the one just opened. The undo offered here is the
   * same one the history gives: the activity and its points are read first, so the toast
   * can put them back and reopen them.
   */
  async deleteActivity() {
    const activity = this.activity();
    if (!activity?.id) return;

    const confirmed = await this.uiService.confirm({
      title: this.ts.t('confirm.title.delete_single'),
      message: this.ts.t('confirm.message.delete_single'),
      confirmText: this.ts.t('confirm.btn.delete'),
      cancelText: this.ts.t('confirm.btn.cancel'),
      type: 'danger',
    });
    if (!confirmed) return;

    const coordinates = this.coordinates();
    await this.db.deleteActivity(activity.id);
    this.routeNavigation.remove(activity.id);

    this.uiService.showToast(this.ts.t('detail.deleted'), {
      label: this.ts.t('history.undo'),
      run: () => void this.restoreDeleted(activity, coordinates),
    });

    this.router.navigate(['/history']);
  }

  private async restoreDeleted(activity: Activity, coordinates: Coordinate[]) {
    await this.db.restoreActivities([activity], coordinates);
    if (activity.id) this.router.navigate(['/activity', activity.id]);
  }

  /** Store a coordinate list and rebuild every visual derived from it. */
  private applyCoordinates(coords: Coordinate[]) {
    this.coordinates.set(coords);

    if (coords.length === 0) {
      // Walking to a route with no points must not leave the previous route's chart on
      // screen under its name.
      this.chartPoints.set([]);
      this.svgPath.set('');
      this.elevationPathChart.set('');
      this.elevationAreaPathChart.set('');
      this.speedPathChart.set('');
      return;
    }

    const lats = coords.map(c => c.lat);
    const lngs = coords.map(c => c.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const latRange = maxLat - minLat;
    const lngRange = maxLng - minLng;
    const padding = Math.max(latRange, lngRange) * 0.1 || 0.01;

    const vbMinX = minLng - padding;
    const vbMinY = -(maxLat + padding);
    const vbWidth = (maxLng - minLng) + padding * 2;
    const vbHeight = (maxLat - minLat) + padding * 2;

    this.svgViewBox.set(`${vbMinX} ${vbMinY} ${vbWidth} ${vbHeight}`);
    this.svgStrokeWidth.set(Math.max(vbWidth, vbHeight) * 0.01); // 1% of the view box

    const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.lng} ${-c.lat}`).join(' ');
    this.svgPath.set(path);

    this.processChartData(coords);
  }

  private processChartData(coords: Coordinate[]) {
    if (coords.length === 0) return;

    let totalDist = 0;
    const points: ChartPoint[] = [];
    const altitudes = fillAltitudeGaps(coords);

    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (i > 0) {
        totalDist += haversine(coords[i - 1].lat, coords[i - 1].lng, c.lat, c.lng);
      }

      const speed = (c.speed || 0) * 3.6;
      points.push({
        distance: totalDist / 1000,
        altitude: altitudes[i],
        speed,
        coordinate: c,
        x: 0,
        yAlt: 0,
        ySpeed: 0,
      });
    }

    if (points.length === 0) return;

    const maxDist = points[points.length - 1].distance || 1;
    const speeds = points.map(p => p.speed);
    const minAlt = Math.min(...altitudes);
    const maxAlt = Math.max(...altitudes);
    const altRange = maxAlt - minAlt;
    const yAltMin = Math.max(0, minAlt - (altRange * 0.1 || 10));
    const yAltMax = maxAlt + (altRange * 0.1 || 10);
    const altScale = yAltMax - yAltMin || 1;

    const maxSpeed = Math.max(...speeds, 5); // At least 5 km/h

    for (const p of points) {
      p.x = (p.distance / maxDist) * 1000;
      p.yAlt = 200 - ((p.altitude - yAltMin) / altScale) * 200;
      p.ySpeed = 200 - (p.speed / maxSpeed) * 200;
    }

    this.chartPoints.set(points);

    const elPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yAlt}`).join(' ');
    this.elevationPathChart.set(elPath);
    this.elevationAreaPathChart.set(`${elPath} L ${points[points.length - 1].x} 200 L 0 200 Z`);

    const spPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.ySpeed}`).join(' ');
    this.speedPathChart.set(spPath);
  }

  onChartHover(event: MouseEvent | TouchEvent) {
    const container = event.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();

    let clientX = 0;
    if (window.TouchEvent && event instanceof TouchEvent) {
      if (event.touches.length === 0) return;
      clientX = event.touches[0].clientX;
    } else {
      clientX = (event as MouseEvent).clientX;
    }

    const relativeX = (clientX - rect.left) / rect.width;
    const clampedX = Math.max(0, Math.min(1, relativeX));

    const points = this.chartPoints();
    if (points.length === 0) return;

    const targetDistance = clampedX * points[points.length - 1].distance;

    let closest = points[0];
    let minDiff = Math.abs(closest.distance - targetDistance);

    // Fast approx binary search could be used, but sequential is fine for < 10k points
    for (const p of points) {
      const diff = Math.abs(p.distance - targetDistance);
      if (diff < minDiff) {
        minDiff = diff;
        closest = p;
      }
    }

    this.hoveredPoint.set(closest);
    this.hoveredCoordinate.set(closest.coordinate);
  }

  onChartLeave() {
    this.hoveredPoint.set(null);
    this.hoveredCoordinate.set(null);
  }


  formatTime(seconds: number | undefined): string {
    if (seconds === undefined) return '0m 0s';
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
  }


  formatMaxSpeed(speed: number | undefined): string {
    if (!speed) return '0.0 km/h';
    return (speed * 3.6).toFixed(1) + ' km/h';
  }

  formatMaxGrade(grade: number | undefined): string {
    if (grade === undefined || grade === null) return '0%';
    return grade.toFixed(1) + '%';
  }

  formatMinGrade(grade: number | undefined): string {
    if (grade === undefined || grade === null) return '0%';
    return grade.toFixed(1) + '%';
  }

  /** Meters below a kilometer, kilometers above it. */
  formatDistance(meters: number): string {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }

  formatSpeed(metersPerSecond: number): string {
    return `${(metersPerSecond * 3.6).toFixed(1)} km/h`;
  }

  // --- Route sharing -------------------------------------------------------

  /**
   * Write the route to a JSON file another Trackingfy user can import.
   *
   * Unlike the sticker, which is a picture, this keeps every coordinate, timestamp and
   * statistic, so the receiving device gets the route itself rather than an image of it.
   */
  async exportRoute() {
    const activity = this.activity();
    if (!activity || this.isExportingRoute()) return;

    this.isExportingRoute.set(true);

    try {
      const payload = buildRouteExport(activity, this.coordinates(), this.ts.version);
      const json = JSON.stringify(payload);
      const datePart = new Date(activity.startTime).toISOString().split('T')[0];
      const fileName = `trackingfy-route-${datePart}-${activity.id}.json`;

      if (Capacitor.isNativePlatform()) {
        const saved = await Filesystem.writeFile({
          path: fileName,
          data: json,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        await Share.share({
          title: this.ts.t('share.route.title'),
          text: this.ts.t('share.route.text'),
          url: saved.uri,
          dialogTitle: this.ts.t('share.route.dialog_title'),
        });
      } else {
        const blob = new Blob([json], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('Error exporting route', e);
      this.appComponent.triggerToast(this.ts.t('detail.export.error'));
    } finally {
      this.isExportingRoute.set(false);
    }
  }

  // --- Route editing -------------------------------------------------------

  startEdit() {
    const manual = this.segments().manual;

    this.isEditing.set(true);
    this.draftPoints.set(manual.map((c) => ({ lat: c.lat, lng: c.lng })));
    this.draftHistory.set([]);
    this.editError.set(null);
    this.hoveredCoordinate.set(null);
    this.hoveredPoint.set(null);

    if (manual.length > 0) {
      // A segment already drawn comes back as it was left, start time included: that is
      // the user's own answer, not something to propose to them again.
      this.seededStartTime.set(manual[0].timestamp);
      this.startTimeInput.set(toLocalInputValue(manual[0].timestamp));
      this.startTimeTouched.set(true);
    } else {
      this.seededStartTime.set(null);
      this.startTimeInput.set('');
      this.startTimeTouched.set(false);
    }
  }

  /** The drawing instructions, kept out of the panel so it stays compact. */
  showEditHelp() {
    this.uiService.info({
      title: this.ts.t('detail.edit.title'),
      message: this.ts.t('detail.edit.help'),
    });
  }

  cancelEdit() {
    this.isEditing.set(false);
    this.draftPoints.set([]);
    this.draftHistory.set([]);
    this.seededStartTime.set(null);
    this.startTimeInput.set('');
    this.startTimeTouched.set(false);
    this.editError.set(null);
  }

  /** Every change to the draft goes through here, so all of them can be undone. */
  private mutateDraft(points: DraftPoint[]) {
    this.draftHistory.update(history => [...history, this.draftPoints()]);
    this.draftPoints.set(points);
    this.refreshSuggestedStartTime();
  }

  onMapClick(point: DraftPoint) {
    if (!this.isEditing()) return;
    this.mutateDraft([...this.draftPoints(), point]);
  }

  onPointMoved(move: { index: number; lat: number; lng: number }) {
    this.mutateDraft(
      this.draftPoints().map((point, i) =>
        i === move.index ? { lat: move.lat, lng: move.lng } : point,
      ),
    );
  }

  onPointRemoved(index: number) {
    this.mutateDraft(this.draftPoints().filter((_, i) => i !== index));
  }

  undoLastChange() {
    const history = this.draftHistory();
    if (history.length === 0) return;

    this.draftPoints.set(history[history.length - 1]);
    this.draftHistory.set(history.slice(0, -1));
    this.refreshSuggestedStartTime();
  }

  clearDraft() {
    // Starting over means the saved start time no longer describes anything, so the
    // proposal from the average pace becomes useful again.
    this.startTimeTouched.set(false);
    this.mutateDraft([]);
  }

  onStartTimeInput(event: Event) {
    this.startTimeTouched.set(true);
    this.startTimeInput.set((event.target as HTMLInputElement).value);
  }

  /**
   * Keep the proposed start time in step with the drawn segment, until the user edits it.
   * Once they do, their value is theirs: only they know when they actually set off.
   */
  private refreshSuggestedStartTime() {
    if (this.startTimeTouched()) return;

    const activity = this.activity();
    if (!activity) return;

    const suggestion = this.routeEditor.suggestStartTime(
      activity,
      this.gpsCoordinates(),
      this.draftPoints(),
    );

    this.startTimeInput.set(suggestion === null ? '' : toLocalInputValue(suggestion));
  }

  /** The latest start time the input accepts: the first recorded fix, minus a minute. */
  maxStartTimeValue = computed(() => {
    const anchor = this.gpsCoordinates()[0];
    if (!anchor) return '';
    return toLocalInputValue(anchor.timestamp - 60000);
  });

  async saveEdit() {
    const context = this.editContext();
    const validation = this.editPreview();

    if (!context || !context.activity.id || !validation || !validation.valid) return;

    this.isSavingEdit.set(true);
    this.editError.set(null);

    try {
      const updated = await this.routeEditor.saveOpeningSegment(
        context,
        this.draftPoints(),
        this.startTimeMs(),
      );

      this.activity.set(updated);
      this.applyCoordinates(await this.db.getCoordinates(context.activity.id));
      this.cancelEdit();
      this.appComponent.triggerToast(this.ts.t('detail.edit.saved'));
    } catch (e) {
      console.error('Error saving route edit', e);
      this.editError.set(this.ts.t('detail.edit.error'));
    } finally {
      this.isSavingEdit.set(false);
    }
  }

  /** Open the composer, where the picture is built before it is shared. */
  openShareComposer() {
    if (this.coordinates().length === 0) return;
    this.isSharingImage.set(true);
  }

  closeShareComposer() {
    this.isSharingImage.set(false);
  }

  onShareFailed(key: string) {
    this.appComponent.triggerToast(this.ts.t(key));
  }

  followRoute() {
    const act = this.activity();
    const coords = this.coordinates();
    if (act && act.id && coords.length > 0) {
      this.trackingService.loadReferenceRoute(coords, act.id);
      this.router.navigate(['/']);
    }
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Someone who has asked the system for less movement should not be handed a slide. */
function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
