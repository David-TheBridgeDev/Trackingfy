import { Injectable, signal } from '@angular/core';
import { DatabaseService, Activity, Coordinate } from './database';

export type TrackingState = 'idle' | 'tracking' | 'paused';

@Injectable({
  providedIn: 'root'
})
export class TrackingService {
  private watchId: number | null = null;
  private currentActivityId: number | null = null;

  state = signal<TrackingState>('idle');
  currentDistance = signal(0); // in meters
  currentTime = signal(0); // in seconds
  currentSpeed = signal(0); // in m/s
  currentClimb = signal(0); // in meters
  currentDescent = signal(0); // in meters
  lastCoordinate = signal<Coordinate | null>(null);

  isTracking = signal(false); // Legacy support for simple checks

  private timerInterval: any;

  constructor(private db: DatabaseService) {
    this.getInitialLocation();
  }

  private getInitialLocation() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // If we are not tracking yet, just set the last coordinate to center the map
          if (this.state() === 'idle') {
            const { latitude, longitude, altitude, speed } = position.coords;
            const { timestamp } = position;
            this.lastCoordinate.set({
              activityId: 0, // Dummy ID
              lat: latitude,
              lng: longitude,
              timestamp,
              altitude: altitude ?? null,
              speed: speed ?? null
            });
          }
        },
        (error) => console.error('Initial geolocation error:', error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    }
  }

  async startTracking(type: string = 'Activity') {
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

    this.startTimer();
    this.startGeolocation();
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

  private startTimer() {
    this.timerInterval = setInterval(() => {
      this.currentTime.update(t => t + 1);
    }, 1000);
  }

  private stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private startGeolocation() {
    if ('geolocation' in navigator) {
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
    // If paused, we still want to keep the "current position" updated for the map, 
    // but we don't record the point in the DB or add to distance.
    const { latitude, longitude, altitude, speed } = position.coords;
    const { timestamp } = position;
    
    const newCoord: Coordinate = {
      activityId: this.currentActivityId!,
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
        // Only add distance if it's more than 2 meters to avoid GPS noise
        if (dist > 2) {
          this.currentDistance.update(d => d + dist);
        }

        // Calculate altitude changes
        if (altitude !== null && last.altitude !== null && last.altitude !== undefined) {
          const diff = altitude - last.altitude;
          if (Math.abs(diff) > 0.5) { // Filter noise
            if (diff > 0) {
              this.currentClimb.update(c => c + diff);
            } else {
              this.currentDescent.update(d => d + Math.abs(diff));
            }
          }
        }
      }
      this.db.addCoordinate(newCoord);
      this.currentSpeed.set(speed || 0);
    }

    this.lastCoordinate.set(newCoord);
  }

  async stopTracking() {
    if (this.state() === 'idle') return;

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.stopTimer();

    const totalDistance = this.currentDistance();
    const totalTime = this.currentTime();
    const avgSpeed = totalTime > 0 ? totalDistance / totalTime : 0;
    const totalClimb = this.currentClimb();
    const totalDescent = this.currentDescent();

    if (this.currentActivityId) {
      await this.db.updateActivity(this.currentActivityId, {
        totalDistance,
        totalTime,
        avgSpeed,
        totalClimb,
        totalDescent,
        endTime: Date.now()
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
