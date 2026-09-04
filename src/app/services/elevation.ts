import { Injectable } from '@angular/core';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Elevation lookup for points that were drawn by hand instead of recorded by GPS.
 *
 * Uses OpenTopoData: `eu_dem25m` first, because Trackingfy is used mostly in Europe and
 * that dataset has 25 m resolution there, falling back to the global `srtm30m` when a
 * point sits outside its coverage. The service is rate limited to one call per second and
 * accepts at most 100 locations per call, so requests are chunked and spaced accordingly.
 */
@Injectable({
  providedIn: 'root',
})
export class ElevationService {
  private readonly baseUrl = 'https://api.opentopodata.org/v1';
  private readonly primaryDataset = 'eu_dem25m';
  private readonly fallbackDataset = 'srtm30m';
  private readonly maxLocationsPerRequest = 100;
  private readonly minRequestIntervalMs = 1100;

  private lastRequestAt = 0;

  /**
   * Elevation in meters for each point, in the same order. Entries are null where no
   * dataset covers the point or the lookup failed; callers treat those as "unknown"
   * rather than as sea level.
   */
  async lookup(points: LatLng[]): Promise<(number | null)[]> {
    if (points.length === 0) return [];

    const elevations: (number | null)[] = [];

    for (let i = 0; i < points.length; i += this.maxLocationsPerRequest) {
      const chunk = points.slice(i, i + this.maxLocationsPerRequest);
      let result = await this.query(chunk, this.primaryDataset);

      // eu_dem25m returns nulls outside Europe; retry those chunks against the global set.
      if (result === null || result.every((e) => e === null)) {
        const fallback = await this.query(chunk, this.fallbackDataset);
        if (fallback !== null) result = fallback;
      }

      elevations.push(...(result ?? chunk.map(() => null)));
    }

    return elevations;
  }

  private async query(points: LatLng[], dataset: string): Promise<(number | null)[] | null> {
    await this.throttle();

    const locations = points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
    const url = `${this.baseUrl}/${dataset}?locations=${encodeURIComponent(locations)}`;

    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      if (!data || !Array.isArray(data.results)) return null;

      return data.results.map((r: any) =>
        typeof r?.elevation === 'number' && isFinite(r.elevation) ? r.elevation : null,
      );
    } catch (e) {
      console.error('Elevation lookup failed:', e);
      return null;
    }
  }

  private async throttle(): Promise<void> {
    const wait = this.minRequestIntervalMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAt = Date.now();
  }
}
