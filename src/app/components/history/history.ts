import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DatabaseService, Activity } from '../../services/database';

@Component({
  selector: 'app-history',
  imports: [CommonModule, RouterLink],
  templateUrl: './history.html',
})
export class HistoryComponent implements OnInit {
  activities = signal<Activity[]>([]);

  constructor(private db: DatabaseService) {}

  async ngOnInit() {
    await this.loadActivities();
  }

  async loadActivities() {
    this.activities.set(await this.db.getActivities());
  }

  formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
  }

  async deleteActivity(id: number | undefined, event: Event) {
    if (!id) return;
    event.stopPropagation();
    event.preventDefault();
    if (confirm('Are you sure you want to delete this activity?')) {
      await this.db.deleteActivity(id);
      await this.loadActivities();
    }
  }
}
