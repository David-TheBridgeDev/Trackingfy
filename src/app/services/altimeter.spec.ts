import { TestBed } from '@angular/core/testing';

const mocks = vi.hoisted(() => ({
  plugin: {
    getCapabilities: vi.fn(),
    getGeoidHeight: vi.fn(),
    startBarometer: vi.fn(),
    stopBarometer: vi.fn(),
    addListener: vi.fn(),
  },
  capacitor: {
    getPlatform: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: mocks.capacitor,
  registerPlugin: () => mocks.plugin,
}));

import { AltimeterService } from './altimeter';

/** Let the plugin's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AltimeterService', () => {
  let service: AltimeterService;

  function create(platform: string) {
    mocks.capacitor.getPlatform.mockReturnValue(platform);
    TestBed.configureTestingModule({});
    service = TestBed.inject(AltimeterService);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.plugin.getCapabilities.mockResolvedValue({ barometer: true, geoid: true });
    mocks.plugin.getGeoidHeight.mockResolvedValue({ geoidHeight: 51.3 });
    mocks.plugin.startBarometer.mockResolvedValue(undefined);
    mocks.plugin.stopBarometer.mockResolvedValue(undefined);
    mocks.plugin.addListener.mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => vi.useRealTimers());

  it('passes altitudes through off Android', () => {
    create('ios');
    expect(service.toSeaLevel(40.4, -3.7, 700)).toBe(700);
    expect(mocks.plugin.getGeoidHeight).not.toHaveBeenCalled();
  });

  it('holds the first altitudes back until it knows the geoid, then corrects them', async () => {
    create('android');
    await service.beginRecording();

    expect(service.toSeaLevel(40.4, -3.7, 700)).toBeNull();
    await settle();
    expect(service.toSeaLevel(40.4, -3.7, 700)).toBeCloseTo(648.7, 6);
  });

  it('keeps a recording uncorrected rather than correcting it halfway', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    create('android');
    let answer: (value: { geoidHeight: number }) => void = () => {};
    mocks.plugin.getGeoidHeight.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await service.beginRecording();

    expect(service.toSeaLevel(40.4, -3.7, 700)).toBeNull();
    vi.advanceTimersByTime(6_000);
    // Waited long enough: from here on the recording keeps the receiver's values.
    expect(service.toSeaLevel(40.4, -3.7, 700)).toBe(700);

    answer({ geoidHeight: 51.3 });
    await Promise.resolve();
    await Promise.resolve();
    expect(service.toSeaLevel(40.4, -3.7, 700)).toBe(700);
  });

  it('does not correct at all where the device has no geoid model', async () => {
    mocks.plugin.getCapabilities.mockResolvedValue({ barometer: false, geoid: false });
    create('android');
    await service.beginRecording();

    expect(service.toSeaLevel(40.4, -3.7, 700)).toBe(700);
  });

  it('offers the latest barometer reading while it is fresh', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    create('android');
    await service.beginRecording();

    const listener = mocks.plugin.addListener.mock.calls[0][1];
    listener({ pressure: 1003.2, time: Date.now() });
    expect(service.currentPressure()).toBe(1003.2);

    vi.advanceTimersByTime(5_000);
    expect(service.currentPressure()).toBeNull();
  });

  it('turns the barometer off when the recording ends', async () => {
    create('android');
    await service.beginRecording();
    await service.endRecording();

    expect(mocks.plugin.startBarometer).toHaveBeenCalledTimes(1);
    expect(mocks.plugin.stopBarometer).toHaveBeenCalledTimes(1);
  });

  it('does not leave the barometer on when the recording ends while it starts', async () => {
    create('android');
    const starting = service.beginRecording();
    await service.endRecording();
    await starting;

    // Either it was never started, or it was stopped again: never left running.
    const started = mocks.plugin.startBarometer.mock.calls.length;
    const stopped = mocks.plugin.stopBarometer.mock.calls.length;
    expect(stopped).toBeGreaterThanOrEqual(started);
  });
});
