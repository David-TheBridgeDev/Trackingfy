import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

export interface Activity {
  id?: number;
  date: Date;
  type: string;
  totalDistance: number; // in meters
  totalTime: number; // in seconds
  avgSpeed: number; // in m/s
  totalClimb: number; // in meters
  totalDescent: number; // in meters
  startTime: number;
  endTime?: number;
}

export interface Coordinate {
  id?: number;
  activityId: number;
  lat: number;
  lng: number;
  timestamp: number;
  altitude?: number | null;
  speed?: number | null;
}

@Injectable({
  providedIn: 'root'
})
export class DatabaseService extends Dexie {
  activities!: Table<Activity, number>;
  coordinates!: Table<Coordinate, number>;

  constructor() {
    super('TrackingfyDB');
    this.version(2).stores({
      activities: '++id, date, type',
      coordinates: '++id, activityId, timestamp'
    });
  }

  async addActivity(activity: Activity): Promise<number> {
    return await this.activities.add(activity);
  }

  async updateActivity(id: number, changes: Partial<Activity>): Promise<number> {
    return await this.activities.update(id, changes);
  }

  async addCoordinate(coordinate: Coordinate): Promise<number> {
    return await this.coordinates.add(coordinate);
  }

  async getActivities(): Promise<Activity[]> {
    return await this.activities.orderBy('date').reverse().toArray();
  }

  async getActivity(id: number): Promise<Activity | undefined> {
    return await this.activities.get(id);
  }

  async getCoordinates(activityId: number): Promise<Coordinate[]> {
    return await this.coordinates.where('activityId').equals(activityId).sortBy('timestamp');
  }

  async deleteActivity(id: number): Promise<void> {
    await this.transaction('rw', this.activities, this.coordinates, async () => {
      await this.coordinates.where('activityId').equals(id).delete();
      await this.activities.delete(id);
    });
  }

  async deleteActivities(ids: number[]): Promise<void> {
    await this.transaction('rw', this.activities, this.coordinates, async () => {
      await this.coordinates.where('activityId').anyOf(ids).delete();
      await this.activities.bulkDelete(ids);
    });
  }
}
