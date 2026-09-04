import { TestBed } from '@angular/core/testing';
import { ElevationService, LatLng } from './elevation';

describe('ElevationService', () => {
  let service: ElevationService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ElevationService],
    });
    service = TestBed.inject(ElevationService);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('returns empty array when points is empty', async () => {
    const result = await service.lookup([]);
    expect(result).toEqual([]);
  });

  it('successfully retrieves elevations from Open-Meteo', async () => {
    const mockResponse = {
      elevation: [650.5, 655.0],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const points: LatLng[] = [
      { lat: 40.4168, lng: -3.7038 },
      { lat: 40.4170, lng: -3.7040 },
    ];

    const result = await service.lookup(points);
    expect(result).toEqual([650.5, 655.0]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const callUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(callUrl).toContain('api.open-meteo.com/v1/elevation');
  });

  it('falls back to Open-Elevation when Open-Meteo fails', async () => {
    const openElevationResponse = {
      results: [
        { latitude: 40.4168, longitude: -3.7038, elevation: 652.0 },
      ],
    };

    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Open-Meteo network timeout'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => openElevationResponse,
      } as Response);

    const points: LatLng[] = [{ lat: 40.4168, lng: -3.7038 }];

    const result = await service.lookup(points);
    expect(result).toEqual([652.0]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const firstUrl = (globalThis.fetch as any).mock.calls[0][0];
    const secondUrl = (globalThis.fetch as any).mock.calls[1][0];
    expect(firstUrl).toContain('api.open-meteo.com');
    expect(secondUrl).toContain('api.open-elevation.com');
  });

  it('returns nulls for points if both providers fail or time out', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Open-Meteo timeout'))
      .mockRejectedValueOnce(new Error('Open-Elevation timeout'));

    const points: LatLng[] = [
      { lat: 40.4168, lng: -3.7038 },
      { lat: 40.4170, lng: -3.7040 },
    ];

    const result = await service.lookup(points);
    expect(result).toEqual([null, null]);
  });
});
