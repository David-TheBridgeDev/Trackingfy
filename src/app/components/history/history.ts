import { Component, OnInit, signal, HostListener, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatabaseService, Activity } from '../../services/database';
import { UIService } from '../../services/ui';
import { TranslationService } from '../../services/translation';

interface DayGroup {
  date: string;
  activities: Activity[];
}

@Component({
  selector: 'app-history',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './history.html',
  styleUrl: './history.css',
})
export class HistoryComponent implements OnInit {
  activities = signal<Activity[]>([]);

  // Selection
  isSelectionMode = signal(false);
  selectedIds = signal<Set<number>>(new Set());

  // Filters & Sorting
  filterType = signal('All');
  sortBy = signal<'date' | 'distance' | 'duration' | 'climb' | 'descent'>('date');
  sortOrder = signal<'asc' | 'desc'>('desc');
  availableTypes = computed(() => {
    const types = new Set(this.activities().map(a => a.type));
    return ['All', ...Array.from(types).sort()];
  });
  filteredActivities = computed(() => {
    let result = [...this.activities()];

    // Type Filter
    const type = this.filterType();
    if (type !== 'All') {
      result = result.filter(a => a.type === type);
    }

    // Sorting
    const order = this.sortOrder() === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      if (this.sortBy() === 'date') {
        return (new Date(a.date).getTime() - new Date(b.date).getTime()) * order;
      }
      if (this.sortBy() === 'distance') {
        return (a.totalDistance - b.totalDistance) * order;
      }
      if (this.sortBy() === 'duration') {
        return (a.totalTime - b.totalTime) * order;
      }
      if (this.sortBy() === 'climb') {
        return (a.totalClimb - b.totalClimb) * order;
      }
      if (this.sortBy() === 'descent') {
        return (a.totalDescent - b.totalDescent) * order;
      }
      return 0;
    });

    return result;
  });

  groupedActivities = computed(() => {
    const groups: DayGroup[] = [];
    const activities = this.filteredActivities();

    activities.forEach(activity => {
      const dateStr = new Date(activity.date).toDateString();
      let group = groups.find(g => g.date === dateStr);
      if (!group) {
        group = { date: dateStr, activities: [] };
        groups.push(group);
      }
      group.activities.push(activity);
    });

    return groups;
  });

  constructor(
    private db: DatabaseService,
    private router: Router,
    private uiService: UIService,
    public ts: TranslationService
  ) {}

  async ngOnInit() {
    this.uiService.setFullScreen(false);
    await this.loadActivities();
  }

  async loadActivities() {
    const allActivities = await this.db.getActivities();
    this.activities.set(allActivities.filter(a => a.endTime !== undefined));
  }

  clearFilters() {
    this.filterType.set('All');
    this.sortBy.set('date');
    this.sortOrder.set('desc');
  }

  toggleSortOrder() {
    this.sortOrder.update(o => o === 'asc' ? 'desc' : 'asc');
  }

  enterSelectionMode(id?: number) {
    this.isSelectionMode.set(true);
    if (id !== undefined) {
      this.selectedIds.update(set => {
        const newSet = new Set(set);
        newSet.add(id);
        return newSet;
      });
    }
  }

  exitSelectionMode() {
    this.isSelectionMode.set(false);
    this.selectedIds.set(new Set());
  }

  toggleSelection(id: number | undefined, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (id === undefined) return;

    this.selectedIds.update(set => {
      const newSet = new Set(set);
      if (newSet.has(id)) {
        newSet.delete(id);
        if (newSet.size === 0) {
          this.isSelectionMode.set(false);
        }
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  isSelected(id: number | undefined): boolean {
    return id !== undefined && this.selectedIds().has(id);
  }

  navigateToActivity(id: number | undefined) {
    if (!id) return;

    if (this.isSelectionMode()) {
      this.toggleSelection(id);
      return;
    }

    this.router.navigate(['/activity', id]);
  }

  formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
  }

  onLongPress(event: Event, id: number | undefined) {
    if (!id) return;
    event.preventDefault();

    if ('vibrate' in navigator) navigator.vibrate(50);

    if (this.isSelectionMode()) {
      this.toggleSelection(id);
    } else {
      this.enterSelectionMode(id);
    }
  }

  async deleteSelected() {
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) return;

    const confirmed = await this.uiService.confirm({
      title: this.ts.t('confirm.title.delete_multiple'),
      message: this.ts.t('confirm.message.delete_multiple', { count: ids.length }),
      confirmText: this.ts.t('confirm.btn.delete_all'),
      cancelText: this.ts.t('confirm.btn.cancel'),
      type: 'danger'
    });

    if (confirmed) {
      await this.db.deleteActivities(ids);
      await this.loadActivities();
      this.exitSelectionMode();
    }
  }
}
