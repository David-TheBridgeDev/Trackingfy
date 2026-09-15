import { computed, inject, Injectable, signal } from '@angular/core';
import {
  Collection,
  DatabaseService,
  DEFAULT_COLLECTION_COLOR,
  normalizeCollectionName,
} from './database';

/**
 * The palette a collection can be painted with.
 *
 * Colours are what makes a tab findable at a glance once there are more of them than fit
 * on screen, so they are picked from a fixed set that reads on both themes rather than
 * from a free colour picker.
 */
export const COLLECTION_COLORS = [
  '#efbc21', // the app's own accent
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#3b82f6',
  '#14b8a6',
  '#22c55e',
] as const;

/** How many characters a collection name may carry. */
export const COLLECTION_NAME_MAX = 30;

export type CollectionCreateResult =
  | { kind: 'created'; collection: Collection }
  | { kind: 'duplicate'; collection: Collection }
  | { kind: 'invalid' };

/**
 * The collections the history is organised by, kept in one place.
 *
 * Both the history and the activity detail read and change them, and a rename made in
 * one has to show up in the other, so the list lives in a signal here rather than in a
 * component that happens to have loaded it first.
 */
@Injectable({
  providedIn: 'root',
})
export class CollectionsService {
  private db = inject(DatabaseService);

  readonly collections = signal<Collection[]>([]);

  readonly byId = computed(() => {
    const map = new Map<number, Collection>();
    for (const collection of this.collections()) {
      if (collection.id !== undefined) map.set(collection.id, collection);
    }
    return map;
  });

  readonly hasCollections = computed(() => this.collections().length > 0);

  async load(): Promise<Collection[]> {
    const collections = await this.db.getCollections();
    this.collections.set(collections);
    return collections;
  }

  get(id: number | undefined): Collection | undefined {
    return id === undefined ? undefined : this.byId().get(id);
  }

  nameOf(id: number | undefined): string | null {
    return this.get(id)?.name ?? null;
  }

  colorOf(id: number | undefined): string {
    return this.get(id)?.color ?? DEFAULT_COLLECTION_COLOR;
  }

  /**
   * Create a collection, unless one with that name is already there.
   *
   * Two tabs with the same name would be indistinguishable in the bar, and the usual way
   * to end up with them is creating a group that was created before, so the existing one
   * is handed back instead and the caller can just move the routes into it.
   */
  async create(rawName: string, color?: string): Promise<CollectionCreateResult> {
    const name = rawName.trim().slice(0, COLLECTION_NAME_MAX);
    if (!name) return { kind: 'invalid' };

    const existing = this.findByName(name);
    if (existing) return { kind: 'duplicate', collection: existing };

    const order = this.collections().reduce((max, c) => Math.max(max, c.order + 1), 0);
    const collection: Omit<Collection, 'id'> = {
      name,
      color: color ?? this.nextColor(),
      order,
      createdAt: Date.now(),
    };

    const id = await this.db.addCollection(collection);
    await this.load();

    return { kind: 'created', collection: { ...collection, id } };
  }

  async rename(id: number, rawName: string): Promise<boolean> {
    const name = rawName.trim().slice(0, COLLECTION_NAME_MAX);
    if (!name) return false;

    const clash = this.findByName(name);
    if (clash && clash.id !== id) return false;

    await this.db.updateCollection(id, { name });
    await this.load();
    return true;
  }

  async setColor(id: number, color: string): Promise<void> {
    await this.db.updateCollection(id, { color });
    await this.load();
  }

  async remove(id: number): Promise<void> {
    await this.db.deleteCollection(id);
    await this.load();
  }

  /** Shift a collection one place along the tab bar. */
  async move(id: number, direction: -1 | 1): Promise<void> {
    const ids = this.collections()
      .map((c) => c.id)
      .filter((value): value is number => value !== undefined);

    const from = ids.indexOf(id);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= ids.length) return;

    [ids[from], ids[to]] = [ids[to], ids[from]];

    await this.db.saveCollectionOrder(ids);
    await this.load();
  }

  /** File routes under a collection, or take them out of every one with `undefined`. */
  async assign(activityIds: number[], collectionId?: number): Promise<void> {
    await this.db.assignCollection(activityIds, collectionId);
  }

  private findByName(name: string): Collection | undefined {
    const key = normalizeCollectionName(name);
    return this.collections().find((c) => normalizeCollectionName(c.name) === key);
  }

  /** Walk the palette so consecutive collections do not come out the same colour. */
  private nextColor(): string {
    const used = new Set(this.collections().map((c) => c.color));
    return COLLECTION_COLORS.find((color) => !used.has(color)) ?? COLLECTION_COLORS[this.collections().length % COLLECTION_COLORS.length];
  }
}
