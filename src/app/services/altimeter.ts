import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { haversine } from './activity-metrics';

interface AltimeterCapabilities {
  barometer: boolean;
  geoid: boolean;
}

interface AltimeterPlugin {
  getCapabilities(): Promise<AltimeterCapabilities>;
  getGeoidHeight(options: {
    latitude: number;
    longitude: number;
  }): Promise<{ geoidHeight: number | null }>;
  startBarometer(): Promise<void>;
  stopBarometer(): Promise<void>;
  addListener(
    eventName: 'pressure',
    listenerFunc: (sample: { pressure: number; time: number }) => void,
  ): Promise<PluginListenerHandle>;
}

const Altimeter = registerPlugin<AltimeterPlugin>('Altimeter');

const NO_CAPABILITIES: AltimeterCapabilities = { barometer: false, geoid: false };

/** The geoid changes slowly: one lookup serves this far around the place it was made. */
const GEOID_REUSE_M = 20_000;
/** How long the first fixes of a recording wait for the lookup before going on without it. */
const GEOID_WAIT_MS = 5_000;
/** After a failed lookup, how long before asking again instead of on every fix. */
const GEOID_RETRY_MS = 60_000;
/** A barometer reading older than this no longer describes the fix it would go with. */
const PRESSURE_MAX_AGE_MS = 3_000;

/**
 * Height information the location plugin does not give: the barometer, and the geoid that
 * turns Android's GPS altitude into altitude above sea level. Backed by the native
 * `Altimeter` plugin (see AltimeterPlugin.java).
 *
 * Android only. iOS already reports altitude above sea level and has no plugin here, and
 * the web has neither, so everywhere else this passes altitudes through and has no
 * pressure to offer.
 */
@Injectable({
  providedIn: 'root',
})
export class AltimeterService {
  readonly available = Capacitor.getPlatform() === 'android';

  private readonly capabilities: Promise<AltimeterCapabilities> = this.available
    ? Altimeter.getCapabilities().catch(() => NO_CAPABILITIES)
    : Promise.resolve(NO_CAPABILITIES);

  private pressureListener: PluginListenerHandle | null = null;
  private pressure: { hPa: number; receivedAt: number } | null = null;
  /**
   * Bumped by every begin and end, so a start still waiting on the plugin when the
   * recording ends knows not to leave the sensor running.
   */
  private session = 0;

  private geoid: { lat: number; lng: number; height: number } | null = null;
  /**
   * Whether the recording in progress corrects its altitudes. Decided once per recording
   * and never switched: going from uncorrected to corrected halfway through would put a
   * 50 m step in the track, and the step would be counted as climb.
   */
  private correction: 'undecided' | 'geoid' | 'none' = 'undecided';
  private waitingSince: number | null = null;
  private lookingUp = false;
  private lookupFailedAt = 0;

  /** A recording starts: the barometer comes on and the correction is decided afresh. */
  async beginRecording(): Promise<void> {
    const session = ++this.session;
    this.correction = 'undecided';
    this.waitingSince = null;
    this.pressure = null;

    const capabilities = await this.capabilities;
    if (session !== this.session) return;

    if (!capabilities.geoid && this.correction === 'undecided') this.correction = 'none';
    if (capabilities.barometer) await this.startBarometer(session);
  }

  async endRecording(): Promise<void> {
    this.session++;
    this.pressure = null;
    await this.stopBarometer();
  }

  /** The latest barometer reading in hPa, or null when there is no recent one. */
  currentPressure(): number | null {
    if (!this.pressure || Date.now() - this.pressure.receivedAt > PRESSURE_MAX_AGE_MS) return null;
    return this.pressure.hPa;
  }

  /**
   * A fix's altitude above mean sea level, or null while that cannot be told yet.
   *
   * The first fixes of a recording wait, without an altitude, for the geoid lookup; it
   * takes milliseconds. If it cannot be made, the whole recording keeps the altitudes the
   * receiver gave rather than mixing the two.
   */
  toSeaLevel(lat: number, lng: number, altitude: number | null | undefined): number | null {
    if (typeof altitude !== 'number' || !isFinite(altitude)) return null;
    if (!this.available || this.correction === 'none') return altitude;

    const geoid = this.geoid;
    const near = geoid !== null && haversine(geoid.lat, geoid.lng, lat, lng) <= GEOID_REUSE_M;
    if (!near) this.lookUpGeoid(lat, lng);

    if (this.correction === 'undecided') {
      if (near) {
        this.correction = 'geoid';
      } else {
        this.waitingSince ??= Date.now();
        if (Date.now() - this.waitingSince < GEOID_WAIT_MS) return null;
        this.correction = geoid ? 'geoid' : 'none';
        if (this.correction === 'none') return altitude;
      }
    }

    // A lookup from further away than the reuse distance is still far closer to the truth
    // than none, and the fresh one for this place is already on its way.
    return altitude - geoid!.height;
  }

  private lookUpGeoid(lat: number, lng: number) {
    if (this.lookingUp || Date.now() - this.lookupFailedAt < GEOID_RETRY_MS) return;
    this.lookingUp = true;

    Altimeter.getGeoidHeight({ latitude: lat, longitude: lng })
      .then(({ geoidHeight }) => {
        if (typeof geoidHeight === 'number' && isFinite(geoidHeight)) {
          this.geoid = { lat, lng, height: geoidHeight };
        } else {
          this.lookupFailed();
        }
      })
      .catch((e) => {
        console.warn('Could not look up the geoid height:', e);
        this.lookupFailed();
      })
      .finally(() => (this.lookingUp = false));
  }

  private lookupFailed() {
    this.lookupFailedAt = Date.now();
    if (this.correction === 'undecided' && !this.geoid) this.correction = 'none';
  }

  private async startBarometer(session: number) {
    if (this.pressureListener) return;

    try {
      this.pressureListener = await Altimeter.addListener('pressure', (sample) => {
        // Arrives from a sensor callback, outside Angular; nothing here needs a render.
        if (typeof sample.pressure === 'number' && isFinite(sample.pressure)) {
          this.pressure = { hPa: sample.pressure, receivedAt: Date.now() };
        }
      });
      await Altimeter.startBarometer();
    } catch (e) {
      // Recording goes on with GPS altitude alone.
      console.warn('Could not start the barometer:', e);
      await this.stopBarometer();
      return;
    }

    // The recording ended while the sensor was starting.
    if (session !== this.session) await this.stopBarometer();
  }

  private async stopBarometer() {
    const listener = this.pressureListener;
    if (!listener) return;
    this.pressureListener = null;

    try {
      await listener.remove();
      await Altimeter.stopBarometer();
    } catch (e) {
      console.warn('Could not stop the barometer:', e);
    }
  }
}
