import { Component, computed, OnInit, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TrackingService } from '../../services/tracking';
import { MapComponent } from '../map/map';
import { UIService } from '../../services/ui';
import { RouterLink } from '@angular/router';
import { TranslationService } from '../../services/translation';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, MapComponent, FormsModule, RouterLink],
  templateUrl: './dashboard.html',
})
export class DashboardComponent implements OnInit {
  @ViewChild('map') mapComponent!: MapComponent;

  showControlModal = signal(false);

  constructor(
    public trackingService: TrackingService,
    public uiService: UIService,
    public ts: TranslationService,
  ) {}

  ngOnInit() {
    this.uiService.setFullScreen(true);
  }

  formattedTime = computed(() => {
    const seconds = this.trackingService.currentTime();
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map((v) => (v < 10 ? '0' + v : v)).join(':');
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
      this.trackingService.startTracking();
    } else {
      this.showControlModal.set(true);
    }
  }

  pauseActivity() {
    this.trackingService.pauseTracking();
    this.showControlModal.set(false);
  }

  resumeActivity() {
    this.trackingService.resumeTracking();
    this.showControlModal.set(false);
  }

  stopActivity() {
    this.showControlModal.set(false);
    this.trackingService.stopTracking();
  }

  closeControlModal() {
    this.showControlModal.set(false);
  }

  recenterMap() {
    if (this.mapComponent) {
      this.mapComponent.recenter();
    }
  }
}
