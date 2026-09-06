import { inject, Injectable } from '@angular/core';
import type { Activity, Coordinate } from './database';
import { haversine } from './route-stats';
import { TranslationService } from './translation';

/**
 * Builds the picture of a route that gets shared to social networks.
 *
 * The image is composed straight onto a canvas rather than rasterised from DOM, because
 * the layers people combine here — map tiles, the route line, an elevation profile and a
 * stats panel — need exact pixel geometry at a fixed export size, and because the map has
 * to share one projection with the route for the two to line up at all.
 *
 * Every layer is optional and every layer is drawn by the same function used for the
 * preview, so what the composer shows is what gets exported.
 */

// --- Formats -------------------------------------------------------------

export type ShareFormatId = 'square' | 'portrait' | 'story';

export interface ShareFormat {
  id: ShareFormatId;
  width: number;
  height: number;
  /** Shown on the format selector; an aspect ratio reads better than a pixel size. */
  label: string;
}

export const SHARE_FORMATS: ShareFormat[] = [
  { id: 'square', width: 1080, height: 1080, label: '1:1' },
  { id: 'portrait', width: 1080, height: 1440, label: '3:4' },
  { id: 'story', width: 1080, height: 1920, label: '9:16' },
];

export function shareFormat(id: ShareFormatId): ShareFormat {
  return SHARE_FORMATS.find((f) => f.id === id) ?? SHARE_FORMATS[0];
}

// --- Options -------------------------------------------------------------

export type ShareStatId =
  | 'distance'
  | 'duration'
  | 'movingTime'
  | 'avgSpeed'
  | 'maxSpeed'
  | 'climb'
  | 'descent'
  | 'maxGrade';

export const SHARE_STAT_IDS: ShareStatId[] = [
  'distance',
  'duration',
  'movingTime',
  'avgSpeed',
  'maxSpeed',
  'climb',
  'descent',
  'maxGrade',
];

/** More than six cells and the panel stops being readable at thumbnail size. */
export const MAX_SHARE_STATS = 6;

export type ShareBackground = 'solid' | 'transparent';

export interface RouteImageOptions {
  format: ShareFormatId;
  theme: 'dark' | 'light';
  /**
   * A solid ground under everything, or none at all.
   *
   * Transparent makes the export a sticker: the panels and the route keep their own
   * translucency and whatever it is dropped onto shows through. It is not the default
   * because apps composite alpha inconsistently, and a full-frame picture that comes out
   * black in one of them is worse than one that always looks the same. The basemap covers
   * the frame, so transparency only means anything with the map layer off.
   */
  background: ShareBackground;
  /** OpenStreetMap tiles behind the route, so the terrain it crossed is recognisable. */
  map: boolean;
  route: boolean;
  /** Horizontal elevation profile, drawn as a band above the stats. */
  elevation: boolean;
  stats: boolean;
  /** Activity type and date, top left. */
  title: boolean;
  branding: boolean;
  statIds: ShareStatId[];
}

export const DEFAULT_ROUTE_IMAGE_OPTIONS: RouteImageOptions = {
  format: 'portrait',
  theme: 'dark',
  background: 'solid',
  map: true,
  route: true,
  elevation: true,
  stats: true,
  title: true,
  branding: true,
  statIds: ['distance', 'duration', 'avgSpeed', 'climb', 'descent', 'maxSpeed'],
};

/** Drop anything a stored preference carries that this build no longer knows about. */
export function normalizeOptions(raw: unknown): RouteImageOptions {
  const source = (raw ?? {}) as Partial<RouteImageOptions>;
  const statIds = Array.isArray(source.statIds)
    ? source.statIds.filter((id): id is ShareStatId => SHARE_STAT_IDS.includes(id as ShareStatId))
    : DEFAULT_ROUTE_IMAGE_OPTIONS.statIds;

  return {
    format: SHARE_FORMATS.some((f) => f.id === source.format)
      ? (source.format as ShareFormatId)
      : DEFAULT_ROUTE_IMAGE_OPTIONS.format,
    theme: source.theme === 'light' ? 'light' : 'dark',
    background: source.background === 'transparent' ? 'transparent' : 'solid',
    map: source.map ?? DEFAULT_ROUTE_IMAGE_OPTIONS.map,
    route: source.route ?? DEFAULT_ROUTE_IMAGE_OPTIONS.route,
    elevation: source.elevation ?? DEFAULT_ROUTE_IMAGE_OPTIONS.elevation,
    stats: source.stats ?? DEFAULT_ROUTE_IMAGE_OPTIONS.stats,
    title: source.title ?? DEFAULT_ROUTE_IMAGE_OPTIONS.title,
    branding: source.branding ?? DEFAULT_ROUTE_IMAGE_OPTIONS.branding,
    statIds: statIds.slice(0, MAX_SHARE_STATS),
  };
}

// --- Projection ----------------------------------------------------------

const TILE_SIZE = 256;
const MAX_TILE_ZOOM = 18;
/** Above this the export asks too much of a volunteer-run tile server in one go. */
const MAX_TILES = 24;

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Web Mercator world pixel for a coordinate at a zoom level — the same projection OSM
 * tiles are cut with, which is what lets the route sit exactly on top of them.
 */
export function projectWorld(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

export function routeBounds(coords: { lat: number; lng: number }[]): Bounds | null {
  if (coords.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const c of coords) {
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
  }

  return { minLat, maxLat, minLng, maxLng };
}

export interface Projection {
  zoom: number;
  /** Export pixels per tile pixel. Above 1 the basemap is upscaled to spare the server. */
  scale: number;
  originX: number;
  originY: number;
  toCanvas(lat: number, lng: number): { x: number; y: number };
}

/** Beyond this the basemap is so soft that it stops adding anything to the picture. */
const MAX_TILE_UPSCALE = 4;

/**
 * Choose the zoom and offset that fit a route inside `rect` on a `canvasW x canvasH` image.
 *
 * The projection covers the whole canvas, not just the rect, so the basemap can bleed
 * behind the panels while the route itself stays inside the area left for it.
 *
 * Tile zoom only comes in whole steps, which on its own would leave a route filling as
 * little as half the frame. So the zoom is floored and the leftover is taken up by
 * `scale`, which stretches the tiles to make the route fill the space it was given. The
 * same lever answers the tile budget: a route spanning a lot of ground drops another zoom
 * level and doubles its scale, asking for a quarter of the tiles. The route line is vector
 * on top and stays sharp whatever the basemap does.
 */
export function fitProjection(
  bounds: Bounds,
  rect: Rect,
  canvasW: number,
  canvasH: number,
  maxTiles = MAX_TILES,
): Projection {
  // Measured once at zoom 0; the span doubles with every level, so the fit is a log2 away.
  // A route with no span at all (a single fix) falls back to the zoom clamp below.
  const nw = projectWorld(bounds.maxLat, bounds.minLng, 0);
  const se = projectWorld(bounds.minLat, bounds.maxLng, 0);
  const spanX = Math.max(se.x - nw.x, 1e-9);
  const spanY = Math.max(se.y - nw.y, 1e-9);

  const exact = Math.min(rect.w / spanX, rect.h / spanY);
  let zoom = Math.max(0, Math.min(MAX_TILE_ZOOM, Math.floor(Math.log2(exact))));

  const scaleFor = (z: number) =>
    Math.min(rect.w / (spanX * Math.pow(2, z)), rect.h / (spanY * Math.pow(2, z)));
  const tilesFor = (s: number) =>
    (Math.ceil(canvasW / (TILE_SIZE * s)) + 1) * (Math.ceil(canvasH / (TILE_SIZE * s)) + 1);

  let scale = scaleFor(zoom);
  while (zoom > 0 && tilesFor(scale) > maxTiles) {
    zoom--;
    scale = scaleFor(zoom);
  }

  // A route small enough to want more than MAX_TILE_ZOOM sits inside the frame instead of
  // filling it, rather than blowing up a single tile past legibility.
  scale = Math.max(1, Math.min(scale, MAX_TILE_UPSCALE));

  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  const center = projectWorld(centerLat, centerLng, zoom);

  const originX = center.x - (rect.x + rect.w / 2) / scale;
  const originY = center.y - (rect.y + rect.h / 2) / scale;

  return {
    zoom,
    scale,
    originX,
    originY,
    toCanvas(lat: number, lng: number) {
      const p = projectWorld(lat, lng, zoom);
      return { x: (p.x - originX) * scale, y: (p.y - originY) * scale };
    },
  };
}

export interface TilePlacement {
  z: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
}

/** Every tile needed to cover the canvas under a projection, with where to draw it. */
export function tileGrid(proj: Projection, canvasW: number, canvasH: number): TilePlacement[] {
  const n = Math.pow(2, proj.zoom);
  const worldRight = proj.originX + canvasW / proj.scale;
  const worldBottom = proj.originY + canvasH / proj.scale;

  const tx0 = Math.floor(proj.originX / TILE_SIZE);
  const tx1 = Math.floor((worldRight - 1e-6) / TILE_SIZE);
  const ty0 = Math.floor(proj.originY / TILE_SIZE);
  const ty1 = Math.floor((worldBottom - 1e-6) / TILE_SIZE);

  const tiles: TilePlacement[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    // Past the north or south edge of the projection there is no tile to ask for.
    if (ty < 0 || ty >= n) continue;
    for (let tx = tx0; tx <= tx1; tx++) {
      tiles.push({
        z: proj.zoom,
        x: ((tx % n) + n) % n, // a view crossing the antimeridian wraps round the world
        y: ty,
        dx: (tx * TILE_SIZE - proj.originX) * proj.scale,
        dy: (ty * TILE_SIZE - proj.originY) * proj.scale,
        size: TILE_SIZE * proj.scale,
      });
    }
  }
  return tiles;
}

// --- Elevation -----------------------------------------------------------

/**
 * Altitude for every fix, with missing readings filled from their nearest neighbours.
 *
 * GPS drops altitude far more often than position, and a gap left at zero would draw a
 * cliff through the middle of the profile.
 */
export function fillAltitudeGaps(coords: Coordinate[]): number[] {
  const filled: number[] = [];

  for (let i = 0; i < coords.length; i++) {
    const alt = coords[i].altitude;
    if (alt !== null && alt !== undefined) {
      filled.push(alt);
      continue;
    }

    let left: number | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const candidate = coords[j].altitude;
      if (candidate !== null && candidate !== undefined) {
        left = candidate;
        break;
      }
    }

    let right: number | null = null;
    for (let j = i + 1; j < coords.length; j++) {
      const candidate = coords[j].altitude;
      if (candidate !== null && candidate !== undefined) {
        right = candidate;
        break;
      }
    }

    if (left !== null && right !== null) filled.push((left + right) / 2);
    else if (left !== null) filled.push(left);
    else if (right !== null) filled.push(right);
    else filled.push(0);
  }

  return filled;
}

export interface ElevationPoint {
  /** Cumulative distance from the start, in meters. */
  distance: number;
  altitude: number;
}

export function elevationSeries(coords: Coordinate[]): ElevationPoint[] {
  if (coords.length === 0) return [];

  const altitudes = fillAltitudeGaps(coords);
  const points: ElevationPoint[] = [];
  let distance = 0;

  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      distance += haversine(coords[i - 1].lat, coords[i - 1].lng, coords[i].lat, coords[i].lng);
    }
    points.push({ distance, altitude: altitudes[i] });
  }

  return points;
}

/**
 * Thin a series down to at most `maxPoints` samples.
 *
 * A two-hour ride carries tens of thousands of fixes while the profile is about a thousand
 * pixels wide, so drawing all of them costs time and changes nothing that can be seen.
 */
export function downsample<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints || maxPoints < 2) return points;

  const step = (points.length - 1) / (maxPoints - 1);
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds) return '0m';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

// --- Rendering -----------------------------------------------------------

export interface RouteImageInput {
  activity: Activity;
  coordinates: Coordinate[];
  options: RouteImageOptions;
  /** Render smaller than the export size, for the live preview. */
  targetWidth?: number;
}

export interface RouteImageResult {
  width: number;
  height: number;
  /** False when the basemap was asked for but no tile could be drawn. */
  mapRendered: boolean;
}

interface Palette {
  panel: string;
  panelBorder: string;
  text: string;
  muted: string;
  backdropTop: string;
  backdropBottom: string;
  scrim: string;
}

const ACCENT = '#efbc21';
const ROUTE_COLOR = '#ef4444';
const CLIMB_COLOR = '#22c55e';
const DESCENT_COLOR = '#ef4444';
const ELEVATION_COLOR = '#eab308';
const TILE_SUBDOMAINS = ['a', 'b', 'c'];
const TILE_TIMEOUT_MS = 6000;
const LOGO_URL = 'icons/favicon-96x96.png';
const FONT_STACK = "'Inter', system-ui, -apple-system, sans-serif";

interface Layout {
  pad: number;
  headerHeight: number;
  routeArea: Rect;
  statsCard: (Rect & { columns: number; rows: number }) | null;
  elevationCard: Rect | null;
  panelsTop: number;
}

@Injectable({ providedIn: 'root' })
export class RouteImageService {
  private ts = inject(TranslationService);

  /** Tiles and the logo are reused across every preview re-render and the final export. */
  private imageCache = new Map<string, HTMLImageElement | null>();

  async render(canvas: HTMLCanvasElement, input: RouteImageInput): Promise<RouteImageResult> {
    const { activity, coordinates, options } = input;
    const format = shareFormat(options.format);

    const width = Math.round(input.targetWidth ?? format.width);
    const height = Math.round((width * format.height) / format.width);

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return { width, height, mapRendered: false };

    const u = width / format.width; // one design unit, so the preview matches the export
    const palette = this.palette(options.theme);

    ctx.clearRect(0, 0, width, height);
    if (options.background === 'solid') {
      this.drawBackdrop(ctx, width, height, palette);
    }

    const layout = this.layout(options, width, height, u);
    const bounds = routeBounds(coordinates);
    const proj = bounds ? fitProjection(bounds, layout.routeArea, width, height) : null;

    let mapRendered = false;
    if (options.map && proj) {
      mapRendered = await this.drawMap(ctx, proj, width, height, palette);
    }

    if (options.route && proj && coordinates.length > 0) {
      this.drawRoute(ctx, proj, coordinates, u, mapRendered);
    }

    // Scrims keep the text legible over whatever the map happens to show underneath: the
    // basemap has no fixed brightness, so light title text can otherwise land on a pale
    // field of fields and vanish.
    if (mapRendered && (options.stats || options.elevation)) {
      this.drawPanelScrim(ctx, width, height, layout.panelsTop, options.theme);
    }

    if (options.title || options.branding) {
      // Awaited rather than read straight from the cache: on a cold start the header
      // would otherwise be drawn before the logo has arrived, only for the next render
      // to add it, and the export could go out without it.
      if (options.branding) await this.loadImage(LOGO_URL);
      if (mapRendered) {
        this.drawHeaderScrim(ctx, width, layout.pad + layout.headerHeight, options.theme);
      }
      // On a transparent export the header sits on whatever the sticker is pasted onto,
      // which could be any colour at all. A scrim would defeat the transparency, so the
      // text carries its own shadow instead.
      const floating = options.background === 'transparent' && !mapRendered;
      this.drawHeader(ctx, activity, options, layout, palette, u, floating);
    }

    if (options.elevation && layout.elevationCard) {
      this.drawElevation(ctx, coordinates, layout.elevationCard, palette, u);
    }

    if (options.stats && layout.statsCard) {
      this.drawStats(ctx, activity, options.statIds, layout.statsCard, palette, u);
    }

    if (mapRendered) {
      this.drawAttribution(ctx, width, height, u);
    }

    return { width, height, mapRendered };
  }

  /** The finished image as a PNG blob, at full export resolution. */
  async toBlob(input: RouteImageInput): Promise<Blob> {
    const canvas = document.createElement('canvas');
    await this.render(canvas, { ...input, targetWidth: undefined });

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas could not be encoded as PNG'));
      }, 'image/png');
    });
  }

  /** Warm the logo so the first render does not draw a header without it. */
  preload(): Promise<unknown> {
    return this.loadImage(LOGO_URL);
  }

  // --- Layout ------------------------------------------------------------

  private layout(options: RouteImageOptions, width: number, height: number, u: number): Layout {
    const pad = 52 * u;
    const gap = 24 * u;

    const headerHeight = options.title || options.branding ? 96 * u : 0;

    const statIds = options.statIds.slice(0, MAX_SHARE_STATS);
    let statsCard: (Rect & { columns: number; rows: number }) | null = null;
    let elevationCard: Rect | null = null;

    let bottom = height - pad;

    if (options.stats && statIds.length > 0) {
      const columns = Math.min(3, statIds.length);
      const rows = Math.ceil(statIds.length / columns);
      const cardHeight = 44 * u * 2 + rows * 116 * u + (rows - 1) * 20 * u;
      statsCard = { x: pad, y: bottom - cardHeight, w: width - pad * 2, h: cardHeight, columns, rows };
      bottom = statsCard.y - gap;
    }

    if (options.elevation) {
      const cardHeight = 208 * u;
      elevationCard = { x: pad, y: bottom - cardHeight, w: width - pad * 2, h: cardHeight };
      bottom = elevationCard.y - gap;
    }

    const routeTop = pad + headerHeight + (headerHeight > 0 ? gap : 0);
    const routeArea: Rect = {
      x: pad + 24 * u,
      y: routeTop,
      w: width - (pad + 24 * u) * 2,
      // A route squeezed into nothing looks broken, so always leave it a usable band.
      h: Math.max(bottom - routeTop, height * 0.2),
    };

    return {
      pad,
      headerHeight,
      routeArea,
      statsCard,
      elevationCard,
      panelsTop: Math.min(elevationCard?.y ?? Infinity, statsCard?.y ?? Infinity, height),
    };
  }

  private palette(theme: 'dark' | 'light'): Palette {
    if (theme === 'light') {
      return {
        panel: 'rgba(255, 255, 255, 0.92)',
        panelBorder: 'rgba(17, 24, 39, 0.08)',
        text: '#111827',
        muted: 'rgba(17, 24, 39, 0.55)',
        backdropTop: '#f8fafc',
        backdropBottom: '#d8dee9',
        scrim: 'rgba(255, 255, 255, 0.28)',
      };
    }
    return {
      panel: 'rgba(10, 10, 12, 0.84)',
      panelBorder: 'rgba(255, 255, 255, 0.12)',
      text: '#ffffff',
      muted: 'rgba(255, 255, 255, 0.62)',
      backdropTop: '#1f2937',
      backdropBottom: '#050505',
      scrim: 'rgba(0, 0, 0, 0.32)',
    };
  }

  // --- Layers ------------------------------------------------------------

  private drawBackdrop(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    palette: Palette,
  ) {
    // The default ground, and why it is the default: a PNG with an alpha background is
    // composited unpredictably by the apps people share to, and comes out solid black in
    // some of them. Someone making a sticker can still ask for no ground at all.
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, palette.backdropTop);
    gradient.addColorStop(1, palette.backdropBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  private async drawMap(
    ctx: CanvasRenderingContext2D,
    proj: Projection,
    width: number,
    height: number,
    palette: Palette,
  ): Promise<boolean> {
    const tiles = tileGrid(proj, width, height);
    const images = await Promise.all(
      tiles.map((tile, index) =>
        this.loadImage(
          `https://${TILE_SUBDOMAINS[index % TILE_SUBDOMAINS.length]}.tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`,
        ),
      ),
    );

    let drawn = 0;
    for (let i = 0; i < tiles.length; i++) {
      const image = images[i];
      if (!image) continue;
      const tile = tiles[i];
      // A pixel of overlap hides the seams left by fractional placement.
      ctx.drawImage(image, tile.dx, tile.dy, tile.size + 1, tile.size + 1);
      drawn++;
    }

    if (drawn === 0) return false;

    // Push the basemap back so the route and the panels stay the subject.
    ctx.fillStyle = palette.scrim;
    ctx.fillRect(0, 0, width, height);
    return true;
  }

  private drawRoute(
    ctx: CanvasRenderingContext2D,
    proj: Projection,
    coordinates: Coordinate[],
    u: number,
    overMap: boolean,
  ) {
    const points = downsample(coordinates, 4000).map((c) => proj.toCanvas(c.lat, c.lng));
    if (points.length === 0) return;

    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    };

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (overMap) {
      // A white casing under the line is what keeps it readable over busy map tiles.
      trace();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 20 * u;
      ctx.stroke();
    } else {
      // With no map there is nothing to separate from, so the halo becomes a glow instead.
      trace();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.lineWidth = 26 * u;
      ctx.stroke();
    }

    trace();
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = 11 * u;
    ctx.stroke();

    this.drawEndpoint(ctx, points[0], CLIMB_COLOR, u);
    if (points.length > 1) {
      this.drawEndpoint(ctx, points[points.length - 1], '#111827', u);
    }
  }

  private drawEndpoint(
    ctx: CanvasRenderingContext2D,
    point: { x: number; y: number },
    color: string,
    u: number,
  ) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 13 * u, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8 * u, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  private drawPanelScrim(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    panelsTop: number,
    theme: 'dark' | 'light',
  ) {
    const top = Math.max(0, panelsTop - height * 0.12);
    const gradient = ctx.createLinearGradient(0, top, 0, height);
    const base = theme === 'dark' ? '0, 0, 0' : '255, 255, 255';
    gradient.addColorStop(0, `rgba(${base}, 0)`);
    gradient.addColorStop(1, `rgba(${base}, 0.55)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, top, width, height - top);
  }

  private drawHeaderScrim(
    ctx: CanvasRenderingContext2D,
    width: number,
    headerBottom: number,
    theme: 'dark' | 'light',
  ) {
    const depth = headerBottom * 1.6;
    const gradient = ctx.createLinearGradient(0, 0, 0, depth);
    const base = theme === 'dark' ? '0, 0, 0' : '255, 255, 255';
    gradient.addColorStop(0, `rgba(${base}, 0.55)`);
    gradient.addColorStop(1, `rgba(${base}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, depth);
  }

  private drawHeader(
    ctx: CanvasRenderingContext2D,
    activity: Activity,
    options: RouteImageOptions,
    layout: Layout,
    palette: Palette,
    u: number,
    floating = false,
  ) {
    const top = layout.pad;

    if (floating) {
      // Opposite the text colour, so it separates the header from a light ground as well
      // as a dark one.
      ctx.shadowColor = options.theme === 'dark' ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.8)';
      ctx.shadowBlur = 10 * u;
    }

    if (options.title) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = palette.text;
      ctx.font = `800 ${44 * u}px ${FONT_STACK}`;
      ctx.fillText(this.ts.t(`activity.${activity.type}`), layout.pad, top + 44 * u);

      ctx.fillStyle = palette.muted;
      ctx.font = `600 ${26 * u}px ${FONT_STACK}`;
      ctx.fillText(this.formatDate(activity.date), layout.pad, top + 82 * u);
    }

    if (options.branding) {
      const logo = this.imageCache.get(LOGO_URL);
      const right = ctx.canvas.width - layout.pad;
      const badge = 52 * u;

      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ACCENT;
      ctx.font = `900 italic ${34 * u}px ${FONT_STACK}`;
      ctx.fillText('TRACKINGFY', right, top + badge / 2 + 4 * u);

      if (logo) {
        const textWidth = ctx.measureText('TRACKINGFY').width;
        ctx.drawImage(logo, right - textWidth - badge - 14 * u, top, badge, badge);
      }
    }

    // Canvas shadow is context state, so it would otherwise blur every card drawn after.
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  private drawElevation(
    ctx: CanvasRenderingContext2D,
    coordinates: Coordinate[],
    card: Rect,
    palette: Palette,
    u: number,
  ) {
    this.drawCard(ctx, card, palette, u);

    const padX = 30 * u;
    const plot: Rect = {
      x: card.x + padX,
      y: card.y + 44 * u,
      w: card.w - padX * 2,
      h: card.h - 44 * u - 34 * u,
    };

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = palette.muted;
    ctx.font = `800 ${20 * u}px ${FONT_STACK}`;
    ctx.fillText(this.ts.t('share.layer.elevation').toUpperCase(), card.x + padX, card.y + 32 * u);

    const series = downsample(elevationSeries(coordinates), 600);
    if (series.length < 2) return;

    const totalDistance = series[series.length - 1].distance || 1;
    const altitudes = series.map((p) => p.altitude);
    const minAlt = Math.min(...altitudes);
    const maxAlt = Math.max(...altitudes);
    const span = maxAlt - minAlt || 1;
    // Headroom above and below, so a flat route does not draw a line stuck to the edge.
    const floor = minAlt - span * 0.12;
    const range = maxAlt + span * 0.12 - floor;

    const toPoint = (p: ElevationPoint) => ({
      x: plot.x + (p.distance / totalDistance) * plot.w,
      y: plot.y + plot.h - ((p.altitude - floor) / range) * plot.h,
    });

    const first = toPoint(series[0]);

    ctx.beginPath();
    ctx.moveTo(first.x, plot.y + plot.h);
    ctx.lineTo(first.x, first.y);
    for (let i = 1; i < series.length; i++) {
      const point = toPoint(series[i]);
      ctx.lineTo(point.x, point.y);
    }
    ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
    ctx.closePath();

    const fill = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
    fill.addColorStop(0, 'rgba(234, 179, 8, 0.45)');
    fill.addColorStop(1, 'rgba(234, 179, 8, 0.05)');
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < series.length; i++) {
      const point = toPoint(series[i]);
      ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = ELEVATION_COLOR;
    ctx.lineWidth = 4 * u;
    ctx.lineJoin = 'round';
    ctx.stroke();

    const baseline = card.y + card.h - 12 * u;
    ctx.fillStyle = palette.muted;
    ctx.font = `700 ${20 * u}px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(minAlt)} m`, plot.x, baseline);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(maxAlt)} m`, plot.x + plot.w, baseline);
    ctx.textAlign = 'center';
    ctx.fillText(`${(totalDistance / 1000).toFixed(2)} km`, plot.x + plot.w / 2, baseline);
  }

  private drawStats(
    ctx: CanvasRenderingContext2D,
    activity: Activity,
    statIds: ShareStatId[],
    card: Rect & { columns: number; rows: number },
    palette: Palette,
    u: number,
  ) {
    this.drawCard(ctx, card, palette, u);

    const padX = 40 * u;
    const cellW = (card.w - padX * 2) / card.columns;
    const cellH = 116 * u;
    const rowGap = 20 * u;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    statIds.slice(0, MAX_SHARE_STATS).forEach((id, index) => {
      const x = card.x + padX + (index % card.columns) * cellW;
      const y = card.y + 44 * u + Math.floor(index / card.columns) * (cellH + rowGap);
      const stat = this.statValue(id, activity);

      ctx.fillStyle = palette.muted;
      ctx.font = `800 ${21 * u}px ${FONT_STACK}`;
      ctx.fillText(stat.label.toUpperCase(), x, y + 22 * u);

      ctx.fillStyle = stat.color ?? palette.text;
      ctx.font = `900 ${58 * u}px ${FONT_STACK}`;
      ctx.fillText(stat.value, x, y + 84 * u);

      if (stat.unit) {
        const valueWidth = ctx.measureText(stat.value).width;
        ctx.font = `600 ${28 * u}px ${FONT_STACK}`;
        ctx.fillText(stat.unit, x + valueWidth + 8 * u, y + 84 * u);
      }
    });
  }

  private drawAttribution(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    u: number,
  ) {
    // Required whenever OpenStreetMap imagery is redistributed, which a shared picture is.
    const text = '© OpenStreetMap';
    ctx.font = `600 ${18 * u}px ${FONT_STACK}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';

    const boxW = ctx.measureText(text).width + 20 * u;
    const boxH = 30 * u;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    this.roundRect(ctx, width - boxW - 8 * u, height - boxH - 8 * u, boxW, boxH, 8 * u);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(text, width - 18 * u, height - 14 * u);
  }

  private drawCard(ctx: CanvasRenderingContext2D, rect: Rect, palette: Palette, u: number) {
    ctx.fillStyle = palette.panel;
    this.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 32 * u);
    ctx.fill();
    ctx.strokeStyle = palette.panelBorder;
    ctx.lineWidth = 2 * u;
    ctx.stroke();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, radius);
      return;
    }
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  // --- Values ------------------------------------------------------------

  /** Label, number and unit for one stat, shared by the image and the composer's chips. */
  statValue(
    id: ShareStatId,
    activity: Activity,
  ): { label: string; value: string; unit?: string; color?: string } {
    switch (id) {
      case 'distance':
        return {
          label: this.ts.t('dashboard.distance'),
          value: (activity.totalDistance / 1000).toFixed(2),
          unit: 'km',
        };
      case 'duration':
        return { label: this.ts.t('dashboard.duration'), value: formatDuration(activity.totalTime) };
      case 'movingTime':
        return {
          label: this.ts.t('dashboard.moving_time'),
          value: formatDuration(activity.movingTime ?? activity.totalTime),
        };
      case 'avgSpeed':
        return {
          label: this.ts.t('dashboard.avg_speed'),
          value: (activity.avgSpeed * 3.6).toFixed(1),
          unit: 'km/h',
        };
      case 'maxSpeed':
        return {
          label: this.ts.t('dashboard.max_speed'),
          value: ((activity.maxSpeed ?? 0) * 3.6).toFixed(1),
          unit: 'km/h',
        };
      case 'climb':
        return {
          label: this.ts.t('dashboard.climb'),
          value: Math.round(activity.totalClimb).toString(),
          unit: 'm',
          color: CLIMB_COLOR,
        };
      case 'descent':
        return {
          label: this.ts.t('dashboard.descent'),
          value: Math.round(activity.totalDescent).toString(),
          unit: 'm',
          color: DESCENT_COLOR,
        };
      case 'maxGrade':
        return {
          label: this.ts.t('dashboard.grade'),
          value: (activity.maxGrade ?? 0).toFixed(1),
          unit: '%',
        };
    }
  }

  private formatDate(date: Date | string): string {
    const value = date instanceof Date ? date : new Date(date);
    return value.toLocaleDateString(this.ts.currentLang() === 'es' ? 'es-ES' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  // --- Assets ------------------------------------------------------------

  /**
   * Load an image for the canvas, or null if it will not come.
   *
   * `crossOrigin` matters more than it looks: without it a tile taints the canvas and
   * `toBlob` throws, so a failed CORS response has to become a missing tile instead.
   */
  private loadImage(url: string): Promise<HTMLImageElement | null> {
    const cached = this.imageCache.get(url);
    if (cached !== undefined) return Promise.resolve(cached);

    return new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';

      const settle = (result: HTMLImageElement | null) => {
        clearTimeout(timer);
        this.imageCache.set(url, result);
        resolve(result);
      };

      const timer = setTimeout(() => settle(null), TILE_TIMEOUT_MS);
      image.onload = () => settle(image);
      image.onerror = () => settle(null);
      image.src = url;
    });
  }
}
