import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { COLLECTION_NAME_MAX, CollectionsService } from '../../services/collections';
import { TranslationService } from '../../services/translation';
import { UIService } from '../../services/ui';

/**
 * The sheet that files routes under a collection.
 *
 * It is shared by the history, where a selection of routes is moved at once, and by the
 * activity detail, where a single route changes tab, so both offer the same list and the
 * same way of creating a collection on the spot instead of two near-identical menus.
 */
@Component({
  selector: 'app-collection-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './collection-picker.html',
})
export class CollectionPickerComponent {
  private collectionsService = inject(CollectionsService);
  private uiService = inject(UIService);
  public ts = inject(TranslationService);

  /** How many routes are about to be moved, for the line under the title. */
  count = input(1);
  /** The collection those routes are in now, marked as the current one in the list. */
  currentId = input<number | null>(null);
  /** How many routes each collection holds, when the caller knows. */
  counts = input<Map<number, number>>(new Map());

  /** The chosen destination: a collection id, or null for no collection at all. */
  picked = output<number | null>();
  closed = output<void>();

  collections = this.collectionsService.collections;

  subtitle = computed(() =>
    this.count() === 1
      ? this.ts.t('collections.move.subtitle_one')
      : this.ts.t('collections.move.subtitle', { count: this.count() }),
  );

  countLabel(id: number | undefined): string {
    const count = id === undefined ? 0 : (this.counts().get(id) ?? 0);
    if (count === 0) return this.ts.t('collections.count_zero');
    if (count === 1) return this.ts.t('collections.count_one');
    return this.ts.t('collections.count', { count });
  }

  /**
   * Create a collection and move the routes into it in one go.
   *
   * Wanting a group that does not exist yet is the common case the first few times, and
   * sending people to a different screen to make it would lose the selection they came
   * here with.
   */
  async createAndPick() {
    const name = await this.uiService.prompt({
      title: this.ts.t('collections.create.title'),
      message: this.ts.t('collections.create.message'),
      placeholder: this.ts.t('collections.create.placeholder'),
      confirmText: this.ts.t('collections.create.confirm'),
      maxLength: COLLECTION_NAME_MAX,
    });
    if (!name) return;

    const result = await this.collectionsService.create(name);
    if (result.kind === 'invalid') return;

    if (result.kind === 'duplicate') {
      this.uiService.showToast(this.ts.t('collections.duplicate'));
    } else {
      this.uiService.showToast(this.ts.t('collections.created', { name: result.collection.name }));
    }

    this.picked.emit(result.collection.id ?? null);
  }
}
