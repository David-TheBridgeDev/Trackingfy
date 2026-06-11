import { Component, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TrackingService } from '../../services/tracking';
import { MapComponent } from '../map/map';
import { UIService } from '../../services/ui';
import {RouterLink} from '@angular/router';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, MapComponent, FormsModule, RouterLink],
  templateUrl: './dashboard.html',
})
export class DashboardComponent implements OnInit {
  selectedType = signal('Cycling');
  activityTypes = ['Cycling', 'Running', 'Walking'];
  showTypeModal = signal(false);

  constructor(
    public trackingService: TrackingService,
    public uiService: UIService
  ) {}

  ngOnInit() {
    this.uiService.setFullScreen(true);
  }

  formattedTime = computed(() => {
    const seconds = this.trackingService.currentTime();
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(v => v < 10 ? '0' + v : v).join(':');
  });

  formattedDistance = computed(() => {
    const meters = this.trackingService.currentDistance();
    return (meters / 1000).toFixed(2) + ' km';
  });

  formattedSpeed = computed(() => {
    const meters = this.trackingService.currentDistance();
    const seconds = this.trackingService.currentTime();
    const avgSpeed = seconds > 0 ? meters / seconds : 0; // m/s
    return (avgSpeed * 3.6).toFixed(1) + ' km/h';
  });

  formattedClimb = computed(() => {
    return this.trackingService.currentClimb().toFixed(0) + ' m';
  });

  formattedDescent = computed(() => {
    return this.trackingService.currentDescent().toFixed(0) + ' m';
  });

  formattedAltitude = computed(() => {
    const alt = this.trackingService.currentAltitude();
    return alt !== null ? alt.toFixed(0) + ' m' : '--';
  });

  toggleTracking() {
    const state = this.trackingService.state();
    if (state === 'idle') {
      this.trackingService.startTracking(this.selectedType());
    } else if (state === 'tracking') {
      this.trackingService.pauseTracking();
    } else if (state === 'paused') {
      this.trackingService.resumeTracking();
    }
  }

  async requestStopTracking() {
    const confirmed = await this.uiService.confirm({
      title: 'Stop Activity?',
      message: 'Are you sure you want to end and save this session?',
      confirmText: 'Stop and Save',
      cancelText: 'Resume',
      type: 'danger'
    });

    if (confirmed) {
      this.trackingService.stopTracking();
    }
  }
}
