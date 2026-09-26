import type { Coordinate } from './database';
import {
  DEFAULT_ROUTE_IMAGE_OPTIONS,
  MAX_SHARE_STATS,
  downsample,
  elevationSeries,
  fillGaps,
  fitProjection,
  formatDuration,
  normalizeOptions,
  projectWorld,
  routeBounds,
  shareFormat,
  tileGrid,
} from './route-image';

function coord(lat: number, lng: number, altitude?: number | null): Coordinate {
  return { activityId: 1, lat, lng, timestamp: 0, altitude };
}

describe('projectWorld', () => {
  it('puts the origin of the projection at the centre of the world at zoom 0', () => {
    const p = projectWorld(0, 0, 0);
    expect(p.x).toBeCloseTo(128, 6);
    expect(p.y).toBeCloseTo(128, 6);
  });

  it('doubles world coordinates with every zoom level', () => {
    const z2 = projectWorld(40.4, -3.7, 2);
    const z3 = projectWorld(40.4, -3.7, 3);
    expect(z3.x).toBeCloseTo(z2.x * 2, 6);
    expect(z3.y).toBeCloseTo(z2.y * 2, 6);
  });

  it('clamps latitudes past the Mercator limit to the top edge, not to infinity', () => {
    const p = projectWorld(89.9, 0, 4);
    expect(isFinite(p.y)).toBe(true);
    expect(p.y).toBeCloseTo(0, 5);
  });
});

describe('routeBounds', () => {
  it('returns null for an empty route', () => {
    expect(routeBounds([])).toBeNull();
  });

  it('spans every coordinate', () => {
    const bounds = routeBounds([coord(40, -4), coord(41, -3), coord(40.5, -5)])!;
    expect(bounds).toEqual({ minLat: 40, maxLat: 41, minLng: -5, maxLng: -3 });
  });
});

describe('fitProjection', () => {
  const rect = { x: 60, y: 120, w: 960, h: 800 };
  const bounds = { minLat: 40.4, maxLat: 40.46, minLng: -3.72, maxLng: -3.66 };

  it('centres the route on the rect it was given, not on the canvas', () => {
    const proj = fitProjection(bounds, rect, 1080, 1440);
    const centre = proj.toCanvas(
      (bounds.minLat + bounds.maxLat) / 2,
      (bounds.minLng + bounds.maxLng) / 2,
    );
    expect(centre.x).toBeCloseTo(rect.x + rect.w / 2, 6);
    expect(centre.y).toBeCloseTo(rect.y + rect.h / 2, 6);
  });

  it('keeps the whole route inside the rect', () => {
    const proj = fitProjection(bounds, rect, 1080, 1440);
    const corners = [
      proj.toCanvas(bounds.maxLat, bounds.minLng),
      proj.toCanvas(bounds.minLat, bounds.maxLng),
    ];
    for (const c of corners) {
      expect(c.x).toBeGreaterThanOrEqual(rect.x - 0.5);
      expect(c.x).toBeLessThanOrEqual(rect.x + rect.w + 0.5);
      expect(c.y).toBeGreaterThanOrEqual(rect.y - 0.5);
      expect(c.y).toBeLessThanOrEqual(rect.y + rect.h + 0.5);
    }
  });

  it('fills the rect along its tighter axis instead of stopping at a whole zoom step', () => {
    const proj = fitProjection(bounds, rect, 1080, 1440);
    const nw = proj.toCanvas(bounds.maxLat, bounds.minLng);
    const se = proj.toCanvas(bounds.minLat, bounds.maxLng);
    const filled = Math.max((se.x - nw.x) / rect.w, (se.y - nw.y) / rect.h);
    expect(filled).toBeCloseTo(1, 6);
  });

  it('upscales the basemap rather than requesting more tiles than the cap allows', () => {
    const proj = fitProjection(bounds, rect, 1080, 1920);
    expect(proj.scale).toBeGreaterThan(1);
    expect(tileGrid(proj, 1080, 1920).length).toBeLessThanOrEqual(24);
  });

  it('survives a route with a single coordinate', () => {
    const point = { minLat: 40.4, maxLat: 40.4, minLng: -3.7, maxLng: -3.7 };
    const proj = fitProjection(point, rect, 1080, 1440);
    expect(proj.zoom).toBeLessThanOrEqual(18);
    expect(isFinite(proj.originX)).toBe(true);
    expect(isFinite(proj.originY)).toBe(true);
  });
});

describe('tileGrid', () => {
  const proj = fitProjection(
    { minLat: 40.4, maxLat: 40.46, minLng: -3.72, maxLng: -3.66 },
    { x: 60, y: 120, w: 960, h: 800 },
    1080,
    1440,
  );

  it('covers the whole canvas, including the area behind the panels', () => {
    const tiles = tileGrid(proj, 1080, 1440);
    const right = Math.max(...tiles.map((t) => t.dx + t.size));
    const bottom = Math.max(...tiles.map((t) => t.dy + t.size));
    expect(Math.min(...tiles.map((t) => t.dx))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.dy))).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(1080);
    expect(bottom).toBeGreaterThanOrEqual(1440);
  });

  it('only asks for tile indices that exist at the zoom level', () => {
    const limit = Math.pow(2, proj.zoom);
    for (const tile of tileGrid(proj, 1080, 1440)) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(limit);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(limit);
    }
  });
});

describe('fillGaps', () => {
  it('averages a gap between two known readings', () => {
    expect(fillGaps([100, null, 200])).toEqual([100, 150, 200]);
  });

  it('carries the nearest reading outwards at the ends', () => {
    expect(fillGaps([undefined, 80, null])).toEqual([80, 80, 80]);
  });

  it('falls back to zero when the route has no altitude at all', () => {
    expect(fillGaps([null, null])).toEqual([0, 0]);
  });
});

describe('elevationSeries', () => {
  it('accumulates distance along the route', () => {
    const series = elevationSeries([
      { ...coord(40, -3, 100), timestamp: 0 },
      { ...coord(40.01, -3, 120), timestamp: 600_000 },
    ]);
    expect(series[0].distance).toBe(0);
    // A hundredth of a degree of latitude is about 1.1 km.
    expect(series[1].distance).toBeGreaterThan(1000);
    expect(series[1].distance).toBeLessThan(1200);
    // A kilometer apart, the filter has every reason to believe both readings.
    expect(series[0].altitude).toBeCloseTo(100, 0);
    expect(series[1].altitude).toBeCloseTo(120, 0);
  });

  it('draws the filtered altitude, not the saw of raw GPS readings', () => {
    // Flat ground at 500 m, walked at 1.4 m/s, with readings alternating 4 m either side.
    const route = Array.from({ length: 200 }, (_, i) => ({
      ...coord(40 + (i * 1.4) / 111_195, -3, 500 + (i % 2 ? 4 : -4)),
      timestamp: i * 1000,
      speed: 1.4,
      accuracy: 5,
    }));

    const altitudes = elevationSeries(route).map((p) => p.altitude);
    const spread = Math.max(...altitudes.slice(20)) - Math.min(...altitudes.slice(20));
    expect(spread).toBeLessThan(2);
  });

  it('returns nothing for an empty route', () => {
    expect(elevationSeries([])).toEqual([]);
  });
});

describe('downsample', () => {
  it('leaves a short series untouched', () => {
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it('keeps the first and last sample so the profile still spans the route', () => {
    const thinned = downsample(
      Array.from({ length: 1000 }, (_, i) => i),
      50,
    );
    expect(thinned.length).toBe(50);
    expect(thinned[0]).toBe(0);
    expect(thinned[thinned.length - 1]).toBe(999);
  });
});

describe('normalizeOptions', () => {
  it('falls back to the defaults for a missing preference', () => {
    expect(normalizeOptions(null)).toEqual(DEFAULT_ROUTE_IMAGE_OPTIONS);
  });

  it('drops stats and formats this build no longer knows', () => {
    const options = normalizeOptions({ format: 'panorama', statIds: ['distance', 'calories'] });
    expect(options.format).toBe(DEFAULT_ROUTE_IMAGE_OPTIONS.format);
    expect(options.statIds).toEqual(['distance']);
  });

  it('never restores more stats than the panel can hold', () => {
    const options = normalizeOptions({
      statIds: [
        'distance',
        'duration',
        'movingTime',
        'avgSpeed',
        'maxSpeed',
        'climb',
        'descent',
        'maxGrade',
      ],
    });
    expect(options.statIds.length).toBe(MAX_SHARE_STATS);
  });

  it('defaults to a solid ground, since alpha composites unpredictably when shared', () => {
    expect(normalizeOptions({}).background).toBe('solid');
    expect(normalizeOptions({ background: 'nonsense' }).background).toBe('solid');
  });

  it('restores a transparent sticker preference', () => {
    expect(normalizeOptions({ background: 'transparent' }).background).toBe('transparent');
  });

  it('keeps a stored layer combination as it was left', () => {
    const options = normalizeOptions({ map: false, elevation: true, stats: false, theme: 'light' });
    expect(options.map).toBe(false);
    expect(options.elevation).toBe(true);
    expect(options.stats).toBe(false);
    expect(options.theme).toBe('light');
  });
});

describe('shareFormat', () => {
  it('exposes only vertical or square aspect ratios', () => {
    for (const format of ['square', 'portrait', 'story'] as const) {
      const resolved = shareFormat(format);
      expect(resolved.height).toBeGreaterThanOrEqual(resolved.width);
    }
  });
});

describe('formatDuration', () => {
  it('drops seconds once an activity runs past an hour', () => {
    expect(formatDuration(3661)).toBe('1h 1m');
  });

  it('keeps seconds for a short activity', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('reads zero for an activity with no time', () => {
    expect(formatDuration(undefined)).toBe('0m');
  });
});
