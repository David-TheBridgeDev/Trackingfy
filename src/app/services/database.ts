import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { isRouteExport, parseRouteExport } from './route-export';

export interface Split {
  kilometer: number; // e.g., 1, 2, 3...
  time: number; // elapsed time for this split in seconds
  speed: number; // average speed in m/s for this split
}

/**
 * Where a coordinate came from. Absent means 'gps': activities recorded before route
 * editing existed have no source field and are entirely GPS data.
 */
export type CoordinateSource = 'gps' | 'manual';

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
  editedAt?: number; // set when the route was edited by hand
  manualDistance?: number; // in meters, of the hand-drawn part
}

export interface Coordinate {
  id?: number;
  activityId: number;
  lat: number;
  lng: number;
  timestamp: number;
  altitude?: number | null;
  speed?: number | null;
  source?: CoordinateSource;
}

export type ImportResult =
  | { kind: 'backup'; imported: number; skipped: number }
  | { kind: 'route'; imported: boolean; activityId?: number };

@Injectable({
  providedIn: 'root'
})
export class DatabaseService extends Dexie {
  activities!: Table<Activity, number>;
  coordinates!: Table<Coordinate, number>;

  constructor() {
    super('TrackingfyDB');
    // The fields added for route editing and route sharing are all optional and
    // unindexed, so they need no schema version bump.
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

  /**
   * Swap an activity's hand-drawn coordinates and update its stats atomically.
   *
   * Removal and insertion belong in the same transaction as the new totals: an edit that
   * half applied would leave a route whose points and numbers disagree, with no way to
   * tell which of the two was right.
   */
  async applyRouteEdit(
    activityId: number,
    removedCoordinateIds: number[],
    newCoordinates: Coordinate[],
    changes: Partial<Activity>
  ): Promise<void> {
    await this.transaction('rw', this.activities, this.coordinates, async () => {
      if (removedCoordinateIds.length > 0) {
        await this.coordinates.bulkDelete(removedCoordinateIds);
      }
      if (newCoordinates.length > 0) {
        await this.coordinates.bulkAdd(newCoordinates);
      }
      await this.activities.update(activityId, changes);
    });
  }

  /**
   * Insert a route shared by another user as a new activity.
   *
   * Deduplication is by startTime, matching the backup importer: re-importing the same
   * file is a no-op rather than a second copy of the same route.
   */
  async importRoute(data: any): Promise<{ imported: boolean; activityId?: number }> {
    const { activity, coordinates } = parseRouteExport(data);

    return await this.transaction('rw', this.activities, this.coordinates, async () => {
      const duplicate = await this.activities.filter(a => a.startTime === activity.startTime).first();
      if (duplicate) {
        return { imported: false, activityId: duplicate.id };
      }

      const activityId = await this.activities.add(activity as Activity);
      await this.coordinates.bulkAdd(
        coordinates.map(c => ({ ...c, activityId })) as Coordinate[]
      );

      return { imported: true, activityId };
    });
  }

  async exportData(): Promise<string> {
    const activities = await this.activities.toArray();
    const coordinates = await this.coordinates.toArray();
    return JSON.stringify({ activities, coordinates });
  }

  /**
   * Restore a full backup, or a single shared route: both arrive through the same
   * "import" entry point in Settings, so the payload shape decides which one it is.
   */
  async importData(jsonString: string): Promise<ImportResult> {
    let data: any;
    try {
      data = JSON.parse(jsonString);
    } catch (e) {
      console.error('Import error:', e);
      throw new Error('Invalid JSON file');
    }

    if (isRouteExport(data)) {
      return { kind: 'route', ...(await this.importRoute(data)) };
    }

    if (!data || !data.activities || !data.coordinates) {
      throw new Error('Invalid backup data format');
    }

    let imported = 0;
    let skipped = 0;

    await this.transaction('rw', this.activities, this.coordinates, async () => {
      // Get existing activities to prevent duplicates
      const existingActivities = await this.activities.toArray();
      const existingStartTimes = new Set(existingActivities.map(a => a.startTime));

      const newCoordinatesToAdd: Coordinate[] = [];

      for (const activity of data.activities as Activity[]) {
        // Check if this activity already exists based on startTime
        if (existingStartTimes.has(activity.startTime)) {
          skipped++;
          continue;
        }

        const oldId = activity.id;

        // Remove original id so Dexie generates a new one
        delete activity.id;

        // Insert the activity to get its new ID
        const newId = await this.activities.add(activity as Activity);
        imported++;

        // Find and map associated coordinates
        const activityCoords = (data.coordinates as Coordinate[]).filter(c => c.activityId === oldId);
        for (const coord of activityCoords) {
          delete coord.id;
          coord.activityId = newId as number;
          newCoordinatesToAdd.push(coord);
        }
      }

      // Insert all newly mapped coordinates
      if (newCoordinatesToAdd.length > 0) {
        await this.coordinates.bulkAdd(newCoordinatesToAdd);
      }
    });

    return { kind: 'backup', imported, skipped };
  }
}
