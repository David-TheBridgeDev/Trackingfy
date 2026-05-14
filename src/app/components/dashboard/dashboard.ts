import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TrackingService } from '../../services/tracking';
import { MapComponent } from '../map/map';
import { UIService } from '../../services/ui';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, MapComponent, FormsModule],
  templateUrl: './dashboard.html',
})
export class DashboardComponent {
  showConfirmModal = signal(false);
  selectedType = signal('Running');
  activityTypes = ['Running', 'Walking', 'Cycling', 'Hiking', 'Other'];

  constructor(
    public trackingService: TrackingService,
    public uiService: UIService
  ) {}

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

  requestStopTracking() {
    this.showConfirmModal.set(true);
  }

  confirmStop() {
    this.trackingService.stopTracking();
    this.showConfirmModal.set(false);
  }

  cancelStop() {
    this.showConfirmModal.set(false);
  }
}
