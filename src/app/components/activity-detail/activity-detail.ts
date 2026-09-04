import { Component, OnInit, signal, computed, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink, Router } from '@angular/router';
import { DatabaseService, Activity, Coordinate } from '../../services/database';
import { MapComponent } from '../map/map';
import { UIService } from '../../services/ui';
import { TrackingService } from '../../services/tracking';
import { TranslationService } from '../../services/translation';
import { RouteEditorService, DraftPoint, PrependValidation } from '../../services/route-editor';
import { buildRouteExport } from '../../services/route-export';
import { App } from '../../app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import html2canvas from 'html2canvas';

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
  imports: [CommonModule, MapComponent, RouterLink],
  templateUrl: './activity-detail.html',
})
export class ActivityDetailComponent implements OnInit {
  @ViewChild('exportContainer') exportContainer!: ElementRef;

  activity = signal<Activity | null>(null);
  coordinates = signal<Coordinate[]>([]);
  isGeneratingSticker = signal(false);
  isExportingRoute = signal(false);

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

  /** Distance of the drawn segment, available before a start time has been entered. */
  draftDistance = computed(() =>
    this.routeEditor.draftDistance(this.draftPoints(), this.coordinates()[0]),
  );

  /** Projected effect of the edit, recomputed on every change to the draft. */
  editPreview = computed<PrependValidation | null>(() => {
    const activity = this.activity();
    const startTime = this.startTimeMs();
    if (!activity || this.draftPoints().length === 0 || startTime === null) return null;

    return this.routeEditor.previewPrepend(
      activity,
      this.coordinates(),
      this.draftPoints(),
      startTime,
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
    return validation && !validation.valid ? validation.reason : null;
  });

  startTimeMs = computed<number | null>(() => {
    const value = this.startTimeInput();
    if (!value) return null;
    const ms = new Date(value).getTime();
    return isNaN(ms) ? null : ms;
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private db: DatabaseService,
    private routeEditor: RouteEditorService,
    private appComponent: App,
    public uiService: UIService,
    public trackingService: TrackingService,
    public ts: TranslationService
  ) {}

  async ngOnInit() {
    this.uiService.setFullScreen(false); // Reset FS when entering
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      const act = await this.db.getActivity(id);
      this.activity.set(act || null);
      const coords = await this.db.getCoordinates(id);
      this.applyCoordinates(coords);
    }
  }

  /** Store a coordinate list and rebuild every visual derived from it. */
  private applyCoordinates(coords: Coordinate[]) {
    this.coordinates.set(coords);
    if (coords.length === 0) return;

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

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dp = ((lat2 - lat1) * Math.PI) / 180;
    const dl = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private processChartData(coords: Coordinate[]) {
    if (coords.length === 0) return;

    let totalDist = 0;
    const points: ChartPoint[] = [];

    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (i > 0) {
        totalDist += this.calculateDistance(coords[i - 1].lat, coords[i - 1].lng, c.lat, c.lng);
      }

      let alt = c.altitude;
      if (alt === null || alt === undefined) {
        let leftAlt = 0, foundLeft = false;
        for (let j = i - 1; j >= 0; j--) {
          if (coords[j].altitude != null) { leftAlt = coords[j].altitude!; foundLeft = true; break; }
        }
        let rightAlt = 0, foundRight = false;
        for (let j = i + 1; j < coords.length; j++) {
          if (coords[j].altitude != null) { rightAlt = coords[j].altitude!; foundRight = true; break; }
        }
        if (foundLeft && foundRight) alt = (leftAlt + rightAlt) / 2;
        else if (foundLeft) alt = leftAlt;
        else if (foundRight) alt = rightAlt;
        else alt = 0;
      }

      const speed = (c.speed || 0) * 3.6;
      points.push({ distance: totalDist / 1000, altitude: alt, speed, coordinate: c, x: 0, yAlt: 0, ySpeed: 0 });
    }

    if (points.length === 0) return;

    const maxDist = points[points.length - 1].distance || 1;
    const altitudes = points.map(p => p.altitude);
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
    this.isEditing.set(true);
    this.draftPoints.set([]);
    this.startTimeInput.set('');
    this.startTimeTouched.set(false);
    this.editError.set(null);
    this.hoveredCoordinate.set(null);
    this.hoveredPoint.set(null);
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
    this.startTimeInput.set('');
    this.startTimeTouched.set(false);
    this.editError.set(null);
  }

  onMapClick(point: DraftPoint) {
    if (!this.isEditing()) return;
    this.draftPoints.update(points => [...points, point]);
    this.refreshSuggestedStartTime();
  }

  undoLastPoint() {
    this.draftPoints.update(points => points.slice(0, -1));
    this.refreshSuggestedStartTime();
  }

  clearDraft() {
    this.draftPoints.set([]);
    this.refreshSuggestedStartTime();
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
      this.coordinates(),
      this.draftPoints(),
    );

    this.startTimeInput.set(suggestion === null ? '' : this.toLocalInputValue(suggestion));
  }

  /** Epoch milliseconds as the local `YYYY-MM-DDTHH:mm` a datetime-local input expects. */
  private toLocalInputValue(ms: number): string {
    const date = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  /** The latest start time the input accepts: the first recorded fix, minus a minute. */
  maxStartTimeValue = computed(() => {
    const anchor = this.coordinates()[0];
    if (!anchor) return '';
    return this.toLocalInputValue(anchor.timestamp - 60000);
  });

  async saveEdit() {
    const activity = this.activity();
    const startTime = this.startTimeMs();
    const validation = this.editPreview();

    if (!activity || !activity.id || startTime === null || !validation || !validation.valid) return;

    this.isSavingEdit.set(true);
    this.editError.set(null);

    try {
      const result = await this.routeEditor.applyPrepend(
        activity,
        this.coordinates(),
        this.draftPoints(),
        startTime,
      );

      this.activity.set(result.activity);
      this.applyCoordinates(await this.db.getCoordinates(activity.id));
      this.cancelEdit();
      this.appComponent.triggerToast(this.ts.t('detail.edit.saved'));
    } catch (e) {
      console.error('Error saving route edit', e);
      this.editError.set(this.ts.t('detail.edit.error'));
    } finally {
      this.isSavingEdit.set(false);
    }
  }

  async shareSticker() {
    if (!this.exportContainer) return;
    this.isGeneratingSticker.set(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 100));

      const canvas = await html2canvas(this.exportContainer.nativeElement, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: null, // Keep transparent or background from css
        scale: 1 // No need to upscale, we are exporting a 1080x1080 block
      });

      const dataUrl = canvas.toDataURL('image/png'); // Export as PNG
      const fileName = `trackingfy-route-${Date.now()}.png`;

      if (Capacitor.getPlatform() === 'web') {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: dataUrl,
          directory: Directory.Cache
        });

        await Share.share({
          title: this.ts.t('share.title'),
          text: this.ts.t('share.text'),
          url: savedFile.uri,
          dialogTitle: this.ts.t('share.dialog_title')
        });
      }
    } catch (e) {
      console.error('Error generating or sharing sticker', e);
    } finally {
      this.isGeneratingSticker.set(false);
    }
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
