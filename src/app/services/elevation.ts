import { Injectable } from '@angular/core';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Elevation lookup for points that were drawn by hand instead of recorded by GPS.
 *
 * Uses Open-Meteo Elevation API as the primary provider (fast, global coverage via
 * Copernicus DEM 90m, no API key, CORS enabled), with Open-Elevation as fallback.
 * Requests are chunked in batches of at most 100 coordinates and protected by a strict
 * 4-second timeout to prevent route saving from hanging if external services fail.
 */
@Injectable({
  providedIn: 'root',
})
export class ElevationService {
  private readonly maxLocationsPerRequest = 100;
  private readonly requestTimeoutMs = 4000;

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
      let result = await this.queryOpenMeteo(chunk);

      // If Open-Meteo failed or returned all nulls, attempt Open-Elevation fallback
      if (result === null || result.every((e) => e === null)) {
        const fallback = await this.queryOpenElevation(chunk);
        if (fallback !== null) result = fallback;
      }

      elevations.push(...(result ?? chunk.map(() => null)));
    }

    return elevations;
  }

  private async queryOpenMeteo(points: LatLng[]): Promise<(number | null)[] | null> {
    const lats = points.map((p) => p.lat.toFixed(6)).join(',');
    const lngs = points.map((p) => p.lng.toFixed(6)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (!response.ok) return null;

      const data = await response.json();
      if (!data || !Array.isArray(data.elevation) || data.elevation.length !== points.length) {
        return null;
      }

      return data.elevation.map((e: any) =>
        typeof e === 'number' && isFinite(e) ? e : null,
      );
    } catch (e) {
      console.warn('Open-Meteo elevation lookup failed:', e);
      return null;
    }
  }

  private async queryOpenElevation(points: LatLng[]): Promise<(number | null)[] | null> {
    const url = 'https://api.open-elevation.com/api/v1/lookup';
    const body = JSON.stringify({
      locations: points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (!response.ok) return null;

      const data = await response.json();
      if (!data || !Array.isArray(data.results) || data.results.length !== points.length) {
        return null;
      }

      return data.results.map((r: any) =>
        typeof r?.elevation === 'number' && isFinite(r.elevation) ? r.elevation : null,
      );
    } catch (e) {
      console.warn('Open-Elevation lookup failed:', e);
      return null;
    }
  }
}
