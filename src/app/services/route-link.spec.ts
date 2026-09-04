import { TestBed } from '@angular/core/testing';

const mocks = vi.hoisted(() => ({
  plugin: {
    consumePendingRoute: vi.fn(),
    addListener: vi.fn(),
  },
  capacitor: {
    isNativePlatform: vi.fn(),
    isPluginAvailable: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: mocks.capacitor,
  registerPlugin: () => mocks.plugin,
}));

import { DatabaseService } from './database';
import { RouteLinkService } from './route-link';

describe('RouteLinkService', () => {
  let service: RouteLinkService;
  let importData: ReturnType<typeof vi.fn>;

  /** Hand the service the callback the plugin would have fired. */
  const emitRoute = async (json: string) => {
    const listener = mocks.plugin.addListener.mock.calls[0][1];
    listener({ data: json });
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.capacitor.isNativePlatform.mockReturnValue(true);
    mocks.capacitor.isPluginAvailable.mockReturnValue(true);
    mocks.plugin.consumePendingRoute.mockResolvedValue({});
    mocks.plugin.addListener.mockResolvedValue({ remove: vi.fn() });

    importData = vi.fn().mockResolvedValue({ kind: 'route', imported: true, activityId: 4 });

    TestBed.configureTestingModule({
      providers: [RouteLinkService, { provide: DatabaseService, useValue: { importData } }],
    });

    service = TestBed.inject(RouteLinkService);
  });

  it('stays out of the way on the web, where there are no intents to receive', async () => {
    mocks.capacitor.isNativePlatform.mockReturnValue(false);

    await service.start();

    expect(mocks.plugin.addListener).not.toHaveBeenCalled();
    expect(mocks.plugin.consumePendingRoute).not.toHaveBeenCalled();
  });

  it('stays out of the way when the installed app predates the native plugin', async () => {
    // The web layer is served remotely and updates on its own, so it will run against
    // older shells that have no RouteImport plugin registered.
    mocks.capacitor.isPluginAvailable.mockReturnValue(false);

    await service.start();

    expect(mocks.plugin.addListener).not.toHaveBeenCalled();
  });

  it('imports the route that launched the app', async () => {
    mocks.plugin.consumePendingRoute.mockResolvedValue({ data: '{"format":"trackingfy.route"}' });

    await service.start();

    expect(importData).toHaveBeenCalledWith('{"format":"trackingfy.route"}');
    expect(service.received()).toEqual({ kind: 'route', imported: true, activityId: 4 });
  });

  it('reports nothing when the app was launched normally', async () => {
    await service.start();

    expect(importData).not.toHaveBeenCalled();
    expect(service.received()).toBeNull();
  });

  it('imports a route that arrives while the app is already open', async () => {
    await service.start();
    await emitRoute('{"format":"trackingfy.route"}');

    expect(importData).toHaveBeenCalledWith('{"format":"trackingfy.route"}');
    expect(service.received()).toEqual({ kind: 'route', imported: true, activityId: 4 });
  });

  it('reports a route it already has instead of duplicating it', async () => {
    importData.mockResolvedValue({ kind: 'route', imported: false, activityId: 9 });

    await service.start();
    await emitRoute('{"format":"trackingfy.route"}');

    expect(service.received()).toEqual({ kind: 'route', imported: false, activityId: 9 });
  });

  it('accepts a full backup shared the same way', async () => {
    importData.mockResolvedValue({ kind: 'backup', imported: 3, skipped: 1 });

    await service.start();
    await emitRoute('{"activities":[],"coordinates":[]}');

    expect(service.received()).toEqual({ kind: 'backup', imported: 3, skipped: 1 });
  });

  it('treats a file that is not ours as an outcome, not a crash', async () => {
    importData.mockRejectedValue(new Error('Not a Trackingfy route file'));

    await service.start();
    await emitRoute('{"something":"else"}');

    expect(service.received()).toEqual({ kind: 'invalid' });
  });

  it('notifies again when the same outcome happens twice', async () => {
    await service.start();

    await emitRoute('{"format":"trackingfy.route"}');
    const first = service.received();

    await emitRoute('{"format":"trackingfy.route"}');
    const second = service.received();

    // Watchers react to a new object, so a second identical result is not swallowed.
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('survives a plugin that fails to set up', async () => {
    mocks.plugin.addListener.mockRejectedValue(new Error('bridge unavailable'));

    await expect(service.start()).resolves.toBeUndefined();
    expect(service.received()).toBeNull();
  });
});
