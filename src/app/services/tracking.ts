import { Injectable, signal, NgZone } from '@angular/core';
import { DatabaseService, Activity, Coordinate, Split } from './database';
import { TranslationService } from './translation';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { BackgroundGeolocationPlugin } from '@capgo/background-geolocation';

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export type TrackingState = 'idle' | 'tracking' | 'paused';

@Injectable({
  providedIn: 'root'
})
export class TrackingService {
  private watchId: number | string | null = null;
  private currentActivityId: number | null = null;
  private startTimeSegment: number | null = null;
  private accumulatedTime: number = 0;

  state = signal<TrackingState>('idle');
  currentDistance = signal(0); // in meters
  currentTime = signal(0); // in seconds
  currentSpeed = signal(0); // in m/s
  currentClimb = signal(0); // in meters
  currentDescent = signal(0); // in meters
  currentAltitude = signal<number | null>(null);
  lastCoordinate = signal<Coordinate | null>(null);
  currentCoordinates = signal<Coordinate[]>([]);
  
  // New metrics
  currentPace = signal(0); // in minutes per km
  avgPace = signal(0); // in minutes per km
  maxSpeed = signal(0); // in m/s
  movingTime = signal(0); // in seconds
  currentGrade = signal(0); // percentage (-100 to +100)
  maxGrade = signal(0); // in % (highest climb)
  minGrade = signal(0); // in % (steepest descent)
  splits = signal<Split[]>([]);
  
  private lastSplitTime: number = 0;
  private lastSmoothedAltitude: number | null = null;
  private lastAccumulatedAltitude: number | null = null;
  private gradeDistanceAccumulator: number = 0;
  private gradeAltitudeBaseline: number | null = null;

  isTracking = signal(false); // Legacy support for simple checks
  permissionDenied = signal(false);
  
  activityTypes = ['Cycling', 'Running'];
  selectedActivityType = signal<string>(localStorage.getItem('trackingfy_selected_activity_type') || 'Cycling');

  setSelectedActivityType(type: string) {
    localStorage.setItem('trackingfy_selected_activity_type', type);
    this.selectedActivityType.set(type);
  }

  private timerInterval: any;

  constructor(
    private db: DatabaseService,
    private ngZone: NgZone,
    private ts: TranslationService
  ) {}

  async requestPermission(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      try {
        return new Promise((resolve) => {
          let resolved = false;
          
          BackgroundGeolocation.start(
            { requestPermissions: true, stale: true },
            async (location, error) => {
              if (error) {
                console.error(error);
                if (!resolved) {
                  resolved = true;
                  this.ngZone.run(() => {
                    this.permissionDenied.set(true);
                  });
                  await BackgroundGeolocation.stop();
                  resolve(false);
                }
                return;
              }
              
              if (location && !resolved) {
                resolved = true;
                this.ngZone.run(() => {
                  this.permissionDenied.set(false);
                  this.lastCoordinate.set({
                    activityId: 0,
                    lat: location.latitude,
                    lng: location.longitude,
                    timestamp: location.time || Date.now(),
                    altitude: location.altitude ?? null,
                    speed: location.speed ?? null
                  });
                  this.currentAltitude.set(location.altitude ?? null);
                });
                await BackgroundGeolocation.stop();
                resolve(true);
              }
            }
          ).catch(e => {
            if (!resolved) {
              resolved = true;
              this.ngZone.run(() => {
                this.permissionDenied.set(true);
              });
              resolve(false);
            }
          });
        });
      } catch (e) {
        this.ngZone.run(() => {
          this.permissionDenied.set(true);
        });
        return false;
      }
    }

    if (!('geolocation' in navigator)) {
      console.error('Geolocation not supported');
      return false;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.ngZone.run(() => {
            this.permissionDenied.set(false);
            const { latitude, longitude, altitude, speed } = position.coords;
            const { timestamp } = position;
            this.lastCoordinate.set({
              activityId: 0,
              lat: latitude,
              lng: longitude,
              timestamp,
              altitude: altitude ?? null,
              speed: speed ?? null
            });
            this.currentAltitude.set(altitude ?? null);
          });
          resolve(true);
        },
        (error) => {
          console.error('Geolocation error:', error);
          this.ngZone.run(() => {
            if (error.code === error.PERMISSION_DENIED) {
              this.permissionDenied.set(true);
            }
          });
          resolve(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  }

  async startTracking(type: string = this.selectedActivityType()) {
    if (this.state() !== 'idle') return;

    const activity: Activity = {
      date: new Date(),
      type: type,
      totalDistance: 0,
      totalTime: 0,
      avgSpeed: 0,
      totalClimb: 0,
      totalDescent: 0,
      startTime: Date.now()
    };

    this.currentActivityId = await this.db.addActivity(activity);
    this.state.set('tracking');
    this.isTracking.set(true);
    this.currentDistance.set(0);
    this.currentTime.set(0);
    this.currentSpeed.set(0);
    this.currentClimb.set(0);
    this.currentDescent.set(0);
    this.lastCoordinate.set(null);
    this.currentCoordinates.set([]);
    this.currentPace.set(0);
    this.avgPace.set(0);
    this.maxSpeed.set(0);
    this.movingTime.set(0);
    this.currentGrade.set(0);
    this.maxGrade.set(0);
    this.minGrade.set(0);
    this.splits.set([]);
    this.lastSplitTime = 0;
    this.lastSmoothedAltitude = null;
    this.lastAccumulatedAltitude = null;
    this.gradeDistanceAccumulator = 0;
    this.gradeAltitudeBaseline = null;
    this.accumulatedTime = 0;

    this.startTimer();
    await this.startGeolocation();
  }

  pauseTracking() {
    if (this.state() !== 'tracking') return;
    this.state.set('paused');
    this.stopTimer();
    this.currentSpeed.set(0);
  }

  resumeTracking() {
    if (this.state() !== 'paused') return;
    this.state.set('tracking');
    this.startTimer();
  }



  private updateCurrentTime() {
    if (this.state() === 'tracking' && this.startTimeSegment !== null) {
      const elapsedInSegment = Math.floor((Date.now() - this.startTimeSegment) / 1000);
      this.currentTime.set(this.accumulatedTime + elapsedInSegment);
    } else {
      this.currentTime.set(this.accumulatedTime);
    }
    
    // Update avgPace
    const distKm = this.currentDistance() / 1000;
    if (distKm > 0) {
      this.avgPace.set((this.currentTime() / 60) / distKm);
    }
  }

  private startTimer() {
    this.startTimeSegment = Date.now();
    this.updateCurrentTime();
    this.timerInterval = setInterval(() => {
      this.updateCurrentTime();
    }, 1000);
  }

  private stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.startTimeSegment !== null) {
      this.accumulatedTime += Math.floor((Date.now() - this.startTimeSegment) / 1000);
      this.startTimeSegment = null;
    }
    this.updateCurrentTime();
  }

  private async startGeolocation() {
    if (Capacitor.isNativePlatform()) {
      try {
        await BackgroundGeolocation.start(
          {
            backgroundMessage: this.ts.t('tracking.bg_message'),
            backgroundTitle: this.ts.t('tracking.bg_title'),
            requestPermissions: true,
            stale: false,
            distanceFilter: 2
          },
          (location) => {
            if (location) {
              // Map Capgo location to standard GeolocationPosition-like object
              const position = {
                coords: {
                  latitude: location.latitude,
                  longitude: location.longitude,
                  altitude: location.altitude,
                  speed: location.speed,
                  accuracy: location.accuracy,
                  altitudeAccuracy: location.altitudeAccuracy,
                  heading: 0 // Default heading
                },
                timestamp: location.time || Date.now()
              } as GeolocationPosition;
              this.handlePosition(position);
            }
          }
        );
        this.watchId = 'native';
      } catch (e) {
        console.error('Error starting background geolocation:', e);
        this.stopTracking();
      }
    } else if ('geolocation' in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.handlePosition(position),
        (error) => console.error('Geolocation error:', error),
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        }
      );
    } else {
      console.error('Geolocation not supported');
      this.stopTracking();
    }
  }

  private handlePosition(position: GeolocationPosition) {
    this.ngZone.run(() => {
      // If paused, we still want to keep the "current position" updated for the map, 
      // but we don't record the point in the DB or add to distance.
      const { latitude, longitude, altitude, speed } = position.coords;
      const { timestamp } = position;
      
      const newCoord: Coordinate = {
        activityId: this.currentActivityId || 0,
        lat: latitude,
        lng: longitude,
        timestamp,
        altitude: altitude ?? null,
        speed: speed ?? null
      };

      if (this.state() === 'tracking') {
        const last = this.lastCoordinate();
        if (last) {
          const dist = this.calculateDistance(
            last.lat,
            last.lng,
            latitude,
            longitude
          );
          const timeDiffSec = (timestamp - last.timestamp) / 1000;
          
          if (timeDiffSec > 0) {
            const calculatedSpeed = dist / timeDiffSec;
            const currentSpeedVal = speed || calculatedSpeed;
            
            // If the average speed between points is greater than 0.3 m/s (approx 1 km/h)
            // or if the instantaneous speed is high and the interval is small (e.g. just started moving)
            if (calculatedSpeed > 0.3 || (currentSpeedVal > 0.3 && timeDiffSec < 10)) {
              this.movingTime.update(m => m + timeDiffSec);
            }
          }

          // Only add distance if it's more than 2 meters to avoid GPS noise
          if (dist > 2) {
            this.currentDistance.update(d => {
              const newDist = d + dist;
              const currentKm = Math.floor(newDist / 1000);
              const lastKm = Math.floor(d / 1000);
              
              if (currentKm > lastKm) {
                const splitTime = this.currentTime() - this.lastSplitTime;
                const splitSpeed = splitTime > 0 ? 1000 / splitTime : 0;
                this.splits.update(s => [...s, {
                  kilometer: currentKm,
                  time: splitTime,
                  speed: splitSpeed
                }]);
                this.lastSplitTime = this.currentTime();
              }
              
              return newDist;
            });

            // Calculate altitude changes only when there is horizontal movement
            if (altitude !== null) {
              // 1. Smooth the altitude using Exponential Moving Average (EMA)
              let smoothed = altitude;
              if (this.lastSmoothedAltitude !== null) {
                const alpha = 0.2; // Smoothing factor (lower = smoother, but more lag)
                smoothed = alpha * altitude + (1 - alpha) * this.lastSmoothedAltitude;
              }
              this.lastSmoothedAltitude = smoothed;

              if (this.lastAccumulatedAltitude === null) {
                this.lastAccumulatedAltitude = smoothed;
              }
              
              if (this.gradeAltitudeBaseline === null) {
                this.gradeAltitudeBaseline = smoothed;
              }

              // 2. Grade calculation (accumulating over 15 meters for stability)
              this.gradeDistanceAccumulator += dist;
              if (this.gradeDistanceAccumulator >= 15) {
                 const grade = ((smoothed - this.gradeAltitudeBaseline) / this.gradeDistanceAccumulator) * 100;
                 // Cap impossible grades (e.g. GPS jumps) to reasonable limits (-45% to +45%)
                 const cappedGrade = Math.max(-45, Math.min(45, grade));
                 
                 this.currentGrade.set(cappedGrade);
                 
                 if (cappedGrade > this.maxGrade()) {
                   this.maxGrade.set(cappedGrade);
                 }
                 if (cappedGrade < this.minGrade()) {
                   this.minGrade.set(cappedGrade);
                 }
                 
                 // Reset baseline for next segment
                 this.gradeDistanceAccumulator = 0;
                 this.gradeAltitudeBaseline = smoothed;
              }

              // 3. Accumulate differences using a threshold and comparing with the last accumulated baseline
              const diff = smoothed - this.lastAccumulatedAltitude;
              const ALTITUDE_THRESHOLD = 2.0; // 2 meters threshold to filter GPS jitter

              if (Math.abs(diff) >= ALTITUDE_THRESHOLD) {
                if (diff > 0) {
                  this.currentClimb.update(c => c + diff);
                } else {
                  this.currentDescent.update(d => d + Math.abs(diff));
                }
                this.lastAccumulatedAltitude = smoothed;
              }
            }
          }
        } else {
          // First coordinate recorded: initialize baseline
          if (altitude !== null) {
            this.lastSmoothedAltitude = altitude;
            this.lastAccumulatedAltitude = altitude;
          }
        }
        this.db.addCoordinate(newCoord);
        this.currentCoordinates.update(coords => [...coords, newCoord]);
        
        const currentSpeedVal = speed || 0;
        this.currentSpeed.set(currentSpeedVal);
        
        if (currentSpeedVal > this.maxSpeed()) {
          this.maxSpeed.set(currentSpeedVal);
        }
        
        if (currentSpeedVal > 0) {
          this.currentPace.set((1000 / currentSpeedVal) / 60);
        } else {
          this.currentPace.set(0);
        }
        
        this.updateCurrentTime();
      }

      this.lastCoordinate.set(newCoord);
      this.currentAltitude.set(altitude ?? null);
    });
  }

  async stopTracking() {
    if (this.state() === 'idle') return;

    if (this.watchId !== null) {
      if (Capacitor.isNativePlatform()) {
        await BackgroundGeolocation.stop();
      } else {
        navigator.geolocation.clearWatch(this.watchId as number);
      }
      this.watchId = null;
    }

    this.stopTimer();

    const totalDistance = this.currentDistance();
    const totalTime = this.currentTime();
    const movingTime = Math.floor(this.movingTime());
    const avgSpeed = movingTime > 0 ? totalDistance / movingTime : 0;
    const totalClimb = this.currentClimb();
    const totalDescent = this.currentDescent();

    if (this.currentActivityId) {
      await this.db.updateActivity(this.currentActivityId, {
        totalDistance,
        totalTime,
        movingTime,
        avgSpeed,
        maxSpeed: this.maxSpeed(),
        maxGrade: this.maxGrade(),
        minGrade: this.minGrade(),
        totalClimb,
        totalDescent,
        endTime: Date.now(),
        splits: this.splits()
      });
    }

    this.state.set('idle');
    this.isTracking.set(false);
    this.currentActivityId = null;
    this.currentTime.set(0);
    this.currentDistance.set(0);
    this.currentSpeed.set(0);
    this.currentClimb.set(0);
    this.currentDescent.set(0);
    this.currentCoordinates.set([]);
    this.currentPace.set(0);
    this.avgPace.set(0);
    this.maxSpeed.set(0);
    this.movingTime.set(0);
    this.currentGrade.set(0);
    this.maxGrade.set(0);
    this.minGrade.set(0);
    this.splits.set([]);
    this.lastSplitTime = 0;
    this.lastSmoothedAltitude = null;
    this.lastAccumulatedAltitude = null;
    this.accumulatedTime = 0;
    this.startTimeSegment = null;
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in meters
  }
}
