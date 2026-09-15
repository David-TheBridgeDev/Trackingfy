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

/**
 * A user-made group of routes, shown as a tab in the history.
 *
 * Collections only label activities: deleting one never deletes the routes inside it,
 * they simply stop being filed under it.
 */
export interface Collection {
  id?: number;
  name: string;
  /** Hex colour of the tab and of the dot on every card that belongs to it. */
  color: string;
  /** Position in the tab bar. Lower comes first. */
  order: number;
  createdAt: number;
}

/** Fallback colour for a collection that arrives without one. */
export const DEFAULT_COLLECTION_COLOR = '#efbc21';

/** Collection names are compared case- and accent-insensitively, and trimmed. */
export function normalizeCollectionName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export interface Activity {
  id?: number;
  /** Title the user gave the route. Absent means it is shown by its type and time. */
  name?: string;
  /** Collection the route was filed under. Absent means it sits outside every one. */
  collectionId?: number;
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
  collections!: Table<Collection, number>;

  constructor() {
    super('TrackingfyDB');
    // The fields added for route editing and route sharing are all optional and
    // unindexed, so they need no schema version bump.
    this.version(2).stores({
      activities: '++id, date, type',
      coordinates: '++id, activityId, timestamp'
    });
    // Collections: a new table, plus an index on the activity's collection so the
    // history can pull a tab's routes without walking every activity. The activity
    // title stays unindexed, since searching it means scanning the list anyway.
    this.version(3).stores({
      activities: '++id, date, type, collectionId',
      coordinates: '++id, activityId, timestamp',
      collections: '++id, order'
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
   * Put back activities that were just deleted, with their coordinates.
   *
   * The records are written with the ids they had, so anything still pointing at them
   * (a restored selection, an open detail view) keeps working after an undo.
   */
  async restoreActivities(activities: Activity[], coordinates: Coordinate[]): Promise<void> {
    if (activities.length === 0) return;

    await this.transaction('rw', this.activities, this.coordinates, async () => {
      await this.activities.bulkPut(activities);
      if (coordinates.length > 0) {
        await this.coordinates.bulkPut(coordinates);
      }
    });
  }

  // --- Collections ---------------------------------------------------------

  async getCollections(): Promise<Collection[]> {
    const collections = await this.collections.toArray();
    return collections.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  async addCollection(collection: Omit<Collection, 'id'>): Promise<number> {
    return await this.collections.add(collection as Collection);
  }

  async updateCollection(id: number, changes: Partial<Collection>): Promise<number> {
    return await this.collections.update(id, changes);
  }

  /**
   * Remove a collection without touching the routes filed under it.
   *
   * A collection is a label, so dropping it returns its routes to the ungrouped tab
   * rather than deleting them: nobody expects renaming their shelves to burn the books.
   */
  async deleteCollection(id: number): Promise<void> {
    await this.transaction('rw', this.activities, this.collections, async () => {
      await this.activities
        .where('collectionId')
        .equals(id)
        .modify(activity => {
          delete activity.collectionId;
        });
      await this.collections.delete(id);
    });
  }

  /** Persist the tab order as the order of the given ids. */
  async saveCollectionOrder(ids: number[]): Promise<void> {
    await this.transaction('rw', this.collections, async () => {
      for (let i = 0; i < ids.length; i++) {
        await this.collections.update(ids[i], { order: i });
      }
    });
  }

  /**
   * File activities under a collection, or take them out of every one.
   *
   * The property is deleted rather than set to undefined when routes are ungrouped, so
   * they stay out of the collectionId index instead of sitting in it under a null key.
   */
  async assignCollection(activityIds: number[], collectionId?: number): Promise<void> {
    if (activityIds.length === 0) return;

    await this.activities
      .where('id')
      .anyOf(activityIds)
      .modify(activity => {
        if (collectionId === undefined) {
          delete activity.collectionId;
        } else {
          activity.collectionId = collectionId;
        }
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
    const collections = await this.collections.toArray();
    return JSON.stringify({ activities, coordinates, collections });
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

    await this.transaction('rw', this.activities, this.coordinates, this.collections, async () => {
      // Restore the collections first: an activity can only be filed under one once the
      // collection exists on this device and its new id is known.
      const collectionIdMap = await this.mergeCollections(data.collections);

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

        // The collection ids in the file are the ids of the device it came from, so a
        // route keeps its group only if that group was remapped to a local one.
        if (activity.collectionId !== undefined) {
          const mapped = collectionIdMap.get(activity.collectionId);
          if (mapped === undefined) {
            delete activity.collectionId;
          } else {
            activity.collectionId = mapped;
          }
        }

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

  /**
   * Bring a backup's collections into this device, and say which local id each of the
   * file's ids became.
   *
   * Collections are matched by name rather than by id: restoring a backup onto a device
   * that already has a "Monte" tab should refill that tab, not sit a second one next to
   * it. Anything not already here is created, keeping the name and colour it had.
   */
  private async mergeCollections(source: unknown): Promise<Map<number, number>> {
    const idMap = new Map<number, number>();
    if (!Array.isArray(source)) return idMap;

    const existing = await this.collections.toArray();
    const byName = new Map(existing.map(c => [normalizeCollectionName(c.name), c.id!]));
    let nextOrder = existing.reduce((max, c) => Math.max(max, c.order + 1), 0);

    for (const raw of source as Collection[]) {
      const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
      if (!name || typeof raw.id !== 'number') continue;

      const key = normalizeCollectionName(name);
      let localId = byName.get(key);

      if (localId === undefined) {
        localId = await this.collections.add({
          name,
          color: typeof raw.color === 'string' ? raw.color : DEFAULT_COLLECTION_COLOR,
          order: nextOrder++,
          createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
        } as Collection);
        byName.set(key, localId);
      }

      idMap.set(raw.id, localId);
    }

    return idMap;
  }
}
