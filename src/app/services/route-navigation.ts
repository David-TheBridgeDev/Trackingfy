import { inject, Injectable, signal } from '@angular/core';
import { DatabaseService } from './database';

/** Where a route sits in the list it was opened from, and what comes either side of it. */
export interface RouteNeighbours {
  /** Zero-based position, or -1 when the route is not in the sequence at all. */
  index: number;
  total: number;
  previousId: number | null;
  nextId: number | null;
}

const NOT_IN_SEQUENCE: RouteNeighbours = {
  index: -1,
  total: 0,
  previousId: null,
  nextId: null,
};

/**
 * The list a route was opened from, so the detail view can walk it like a photo gallery.
 *
 * Swiping from one route to the next only makes sense against an order the user has in
 * mind, and that order is whatever the history was showing when they tapped: the open
 * collection, the search they had typed, the sort they chose. The list publishes those
 * ids here on its way out, and the detail view reads them back instead of inventing an
 * order of its own. Anything that opens a route without setting a sequence -- a shared
 * route, a reopened tab -- falls back to the whole history, newest first.
 */
@Injectable({
  providedIn: 'root',
})
export class RouteNavigationService {
  private db = inject(DatabaseService);

  /** The ids to walk, in the order they were shown. */
  readonly sequence = signal<number[]>([]);

  /** What that order was: the name of the tab it came from, for the position line. */
  readonly label = signal<string | null>(null);

  /** The fallback being loaded, if any, so two screens do not read the database twice. */
  private loading?: Promise<void>;

  setSequence(ids: number[], label: string | null = null): void {
    this.sequence.set([...ids]);
    this.label.set(label);
  }

  clear(): void {
    this.sequence.set([]);
    this.label.set(null);
  }

  /** Drop a route that no longer exists, so the gallery does not step onto a gap. */
  remove(id: number): void {
    this.sequence.update((ids) => ids.filter((value) => value !== id));
  }

  neighbours(id: number | undefined): RouteNeighbours {
    if (id === undefined) return NOT_IN_SEQUENCE;

    const ids = this.sequence();
    const index = ids.indexOf(id);
    if (index === -1) return { ...NOT_IN_SEQUENCE, total: ids.length };

    return {
      index,
      total: ids.length,
      previousId: index > 0 ? ids[index - 1] : null,
      nextId: index < ids.length - 1 ? ids[index + 1] : null,
    };
  }

  /**
   * Make sure the route being looked at belongs to a sequence.
   *
   * Opening a route from anywhere other than the history leaves no order behind, and so
   * does coming back to the app on a detail URL. Rather than showing nothing, the whole
   * history is loaded in its default order, which is the list the route would have been
   * tapped from anyway.
   */
  async ensureContains(id: number, label: string | null = null): Promise<void> {
    if (this.sequence().includes(id)) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const activities = await this.db.getActivities();
      const ids = activities
        .filter((activity) => activity.endTime !== undefined && activity.id !== undefined)
        .map((activity) => activity.id as number);

      this.setSequence(ids, label);
    })().finally(() => {
      this.loading = undefined;
    });

    return this.loading;
  }
}
