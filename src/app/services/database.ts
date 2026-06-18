import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

export interface Split {
  kilometer: number; // e.g., 1, 2, 3...
  time: number; // elapsed time for this split in seconds
  speed: number; // average speed in m/s for this split
}

export interface Activity {
  id?: number;
  date: Date;
  type: string;
  totalDistance: number; // in meters
  totalTime: number; // in seconds
  movingTime?: number; // in seconds
  avgSpeed: number; // in m/s
  maxSpeed?: number; // in m/s
  maxGrade?: number; // in %
  minGrade?: number; // in %
  totalClimb: number; // in meters
  totalDescent: number; // in meters
  startTime: number;
  endTime?: number;
  splits?: Split[];
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

  async exportData(): Promise<string> {
    const activities = await this.activities.toArray();
    const coordinates = await this.coordinates.toArray();
    return JSON.stringify({ activities, coordinates });
  }

  async importData(jsonString: string): Promise<void> {
    try {
      const data = JSON.parse(jsonString);
      if (data && data.activities && data.coordinates) {
        await this.transaction('rw', this.activities, this.coordinates, async () => {
          // Get existing activities to prevent duplicates
          const existingActivities = await this.activities.toArray();
          const existingStartTimes = new Set(existingActivities.map(a => a.startTime));

          const newCoordinatesToAdd: Coordinate[] = [];

          for (const activity of data.activities as Activity[]) {
            // Check if this activity already exists based on startTime
            if (!existingStartTimes.has(activity.startTime)) {
              const oldId = activity.id;
              
              // Remove original id so Dexie generates a new one
              delete activity.id;
              
              // Insert the activity to get its new ID
              const newId = await this.activities.add(activity as Activity);
              
              // Find and map associated coordinates
              const activityCoords = (data.coordinates as Coordinate[]).filter(c => c.activityId === oldId);
              for (const coord of activityCoords) {
                delete coord.id;
                coord.activityId = newId as number;
                newCoordinatesToAdd.push(coord);
              }
            }
          }

          // Insert all newly mapped coordinates
          if (newCoordinatesToAdd.length > 0) {
            await this.coordinates.bulkAdd(newCoordinatesToAdd);
          }
        });
      } else {
        throw new Error('Invalid backup data format');
      }
    } catch (e) {
      console.error('Import error:', e);
      throw e;
    }
  }
}
