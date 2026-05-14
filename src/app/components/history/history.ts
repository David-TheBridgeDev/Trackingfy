import { Component, OnInit, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { DatabaseService, Activity } from '../../services/database';

@Component({
  selector: 'app-history',
  imports: [CommonModule],
  templateUrl: './history.html',
})
export class HistoryComponent implements OnInit {
  activities = signal<Activity[]>([]);
  activeDeleteId = signal<number | null>(null);

  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event) {
    if (this.activeDeleteId() !== null) {
      this.activeDeleteId.set(null);
    }
  }

  constructor(private db: DatabaseService, private router: Router) {}

  async ngOnInit() {
    await this.loadActivities();
  }

  async loadActivities() {
    this.activities.set(await this.db.getActivities());
  }

  navigateToActivity(id: number | undefined) {
    if (!id) return;
    
    // If we are in "delete mode" for this card, clicking it just closes the mode
    if (this.activeDeleteId() === id) {
      this.activeDeleteId.set(null);
      return;
    }
    
    // Otherwise navigate
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
    // On touch devices, contextmenu is triggered by long press
    if (window.matchMedia('(hover: none)').matches) {
      event.preventDefault();
      this.activeDeleteId.set(this.activeDeleteId() === id ? null : id);
      if ('vibrate' in navigator) navigator.vibrate(50);
    }
  }

  async deleteActivity(id: number | undefined, event: Event) {
    if (!id) return;
    event.stopPropagation();
    event.preventDefault();
    if (confirm('Are you sure you want to delete this activity?')) {
      await this.db.deleteActivity(id);
      await this.loadActivities();
      this.activeDeleteId.set(null);
    }
  }
}
