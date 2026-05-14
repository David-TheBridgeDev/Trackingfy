import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatabaseService, Activity, Coordinate } from '../../services/database';
import { MapComponent } from '../map/map';

import { UIService } from '../../services/ui';

@Component({
  selector: 'app-activity-detail',
  imports: [CommonModule, MapComponent, RouterLink],
  templateUrl: './activity-detail.html',
})
export class ActivityDetailComponent implements OnInit {
  activity = signal<Activity | null>(null);
  coordinates = signal<Coordinate[]>([]);

  constructor(
    private route: ActivatedRoute,
    private db: DatabaseService,
    public uiService: UIService
  ) {}

  async ngOnInit() {
    this.uiService.setFullScreen(false); // Reset FS when entering
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      const act = await this.db.getActivity(id);
      this.activity.set(act || null);
      this.coordinates.set(await this.db.getCoordinates(id));
    }
  }

  formatTime(seconds: number | undefined): string {
    if (seconds === undefined) return '0m 0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
  }
}
