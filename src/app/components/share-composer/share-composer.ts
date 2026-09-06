import {
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { Activity, Coordinate } from '../../services/database';
import { TranslationService } from '../../services/translation';
import {
  DEFAULT_ROUTE_IMAGE_OPTIONS,
  MAX_SHARE_STATS,
  RouteImageOptions,
  RouteImageService,
  SHARE_FORMATS,
  SHARE_STAT_IDS,
  ShareBackground,
  ShareFormatId,
  ShareStatId,
  normalizeOptions,
} from '../../services/route-image';

type LayerId = 'map' | 'route' | 'elevation' | 'stats' | 'title' | 'branding';

const PREFERENCES_KEY = 'trackingfy_share_image';
/** Wide enough that the preview shows what the export will, small enough to redraw fast. */
const PREVIEW_WIDTH = 620;

/**
 * The sheet where a route picture gets built before it is shared.
 *
 * Every control writes straight into the options the renderer takes, and the preview is
 * produced by that same renderer, so there is no second layout to keep in step. Choices
 * are remembered between shares: people settle on a look and then want it every time.
 */
@Component({
  selector: 'app-share-composer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './share-composer.html',
})
export class ShareComposerComponent implements OnDestroy {
  @ViewChild('preview') previewCanvas?: ElementRef<HTMLCanvasElement>;

  activity = input.required<Activity>();
  coordinates = input.required<Coordinate[]>();

  closed = output<void>();
  /** Raised with a translation key when the picture could not be produced or shared. */
  failed = output<string>();

  readonly formats = SHARE_FORMATS;
  readonly statIds = SHARE_STAT_IDS;
  readonly maxStats = MAX_SHARE_STATS;
  readonly layers: LayerId[] = ['map', 'route', 'elevation', 'stats', 'title', 'branding'];

  options = signal<RouteImageOptions>(loadPreferences());
  isRendering = signal(false);
  isSharing = signal(false);
  /** Set when the basemap was asked for and no tile arrived, so the sheet can say so. */
  mapUnavailable = signal(false);

  ts = inject(TranslationService);
  private images = inject(RouteImageService);
  private renderTimer?: ReturnType<typeof setTimeout>;
  /** Guards against a slow render (tiles) landing after a newer one has already drawn. */
  private renderToken = 0;

  previewRatio = computed(() => {
    const format = this.formats.find((f) => f.id === this.options().format) ?? this.formats[0];
    return `${format.width} / ${format.height}`;
  });

  constructor() {
    this.images.preload();

    // Re-renders on every option change, and on the language change that relabels it.
    effect(() => {
      const options = this.options();
      this.ts.currentLang();
      savePreferences(options);
      this.scheduleRender();
    });
  }

  ngOnDestroy() {
    clearTimeout(this.renderTimer);
  }

  // --- Controls ----------------------------------------------------------

  setFormat(format: ShareFormatId) {
    this.options.update((o) => ({ ...o, format }));
  }

  setTheme(theme: 'dark' | 'light') {
    this.options.update((o) => ({ ...o, theme }));
  }

  setBackground(background: ShareBackground) {
    if (background === 'transparent' && this.options().map) return;
    this.options.update((o) => ({ ...o, background }));
  }

  /**
   * The basemap is drawn edge to edge, so with it on there is no ground left to see
   * through. Rather than offer a control that quietly does nothing, it is held closed and
   * the sheet says why.
   */
  transparentBlocked = computed(() => this.options().map);

  isLayerOn(layer: LayerId): boolean {
    return this.options()[layer];
  }

  toggleLayer(layer: LayerId) {
    this.options.update((o) => {
      const next = { ...o, [layer]: !o[layer] };
      if (layer === 'map' && next.map) next.background = 'solid';
      return next;
    });
  }

  isStatOn(id: ShareStatId): boolean {
    return this.options().statIds.includes(id);
  }

  /** A stat can always be removed; adding one is refused once the panel is full. */
  statDisabled(id: ShareStatId): boolean {
    const current = this.options().statIds;
    return !current.includes(id) && current.length >= MAX_SHARE_STATS;
  }

  toggleStat(id: ShareStatId) {
    this.options.update((o) => {
      if (o.statIds.includes(id)) {
        return { ...o, statIds: o.statIds.filter((s) => s !== id) };
      }
      if (o.statIds.length >= MAX_SHARE_STATS) return o;
      return { ...o, statIds: [...o.statIds, id] };
    });
  }

  statLabel(id: ShareStatId): string {
    return this.images.statValue(id, this.activity()).label;
  }

  layerLabel(layer: LayerId): string {
    return this.ts.t(`share.layer.${layer}`);
  }

  reset() {
    this.options.set({ ...DEFAULT_ROUTE_IMAGE_OPTIONS });
  }

  close() {
    this.closed.emit();
  }

  // --- Preview -----------------------------------------------------------

  /**
   * Coalesce bursts of taps into one render.
   *
   * Toggling several layers in a row would otherwise start a render per tap, and each of
   * those may be waiting on map tiles.
   */
  private scheduleRender() {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.renderPreview(), 90);
  }

  private async renderPreview() {
    const canvas = this.previewCanvas?.nativeElement;
    if (!canvas) {
      // The view has not been attached yet on the very first pass; try once more.
      this.renderTimer = setTimeout(() => this.renderPreview(), 60);
      return;
    }

    const token = ++this.renderToken;
    const options = this.options();
    this.isRendering.set(true);

    try {
      const result = await this.images.render(canvas, {
        activity: this.activity(),
        coordinates: this.coordinates(),
        options,
        targetWidth: PREVIEW_WIDTH,
      });
      if (token !== this.renderToken) return;
      this.mapUnavailable.set(options.map && !result.mapRendered);
    } catch (e) {
      console.error('Error rendering route image preview', e);
    } finally {
      if (token === this.renderToken) this.isRendering.set(false);
    }
  }

  // --- Export ------------------------------------------------------------

  async share() {
    if (this.isSharing()) return;
    this.isSharing.set(true);

    try {
      const blob = await this.images.toBlob({
        activity: this.activity(),
        coordinates: this.coordinates(),
        options: this.options(),
      });

      const activity = this.activity();
      const datePart = new Date(activity.startTime).toISOString().split('T')[0];
      const fileName = `trackingfy-${datePart}-${activity.id ?? 'route'}.png`;

      if (Capacitor.isNativePlatform()) {
        const saved = await Filesystem.writeFile({
          path: fileName,
          data: await blobToDataUrl(blob),
          directory: Directory.Cache,
        });
        await Share.share({
          title: this.ts.t('share.title'),
          text: this.ts.t('share.text'),
          url: saved.uri,
          dialogTitle: this.ts.t('share.dialog_title'),
        });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      this.closed.emit();
    } catch (e) {
      console.error('Error sharing route image', e);
      this.failed.emit('share.error');
    } finally {
      this.isSharing.set(false);
    }
  }
}

function loadPreferences(): RouteImageOptions {
  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    return normalizeOptions(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_ROUTE_IMAGE_OPTIONS };
  }
}

function savePreferences(options: RouteImageOptions) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(options));
  } catch {
    // A full or blocked storage only costs the next share its remembered layout.
  }
}

/** Capacitor's Filesystem writes base64, so the blob has to be re-encoded for native. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image blob'));
    reader.readAsDataURL(blob);
  });
}
