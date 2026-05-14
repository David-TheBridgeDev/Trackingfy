import { Component, input, effect, ElementRef, ViewChild, AfterViewInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as L from 'leaflet';
import { Coordinate } from '../../services/database';
import { UIService } from '../../services/ui';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="relative w-full h-full">
      <div #mapContainer class="w-full h-full"></div>
      
      <!-- Recenter Button -->
      @if (!isFollowing()) {
        <button 
          (click)="recenter()"
          class="absolute top-6 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm text-text-heading px-4 py-2 rounded-full shadow-xl border border-gray-100 flex items-center space-x-2 z-[1000] active:scale-95 transition-all animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span class="text-[10px] font-black uppercase tracking-widest">Recenter</span>
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; height: 100%; }
  `]
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef;
  
  coordinates = input<Coordinate[]>([]);
  currentPoint = input<Coordinate | null>(null);

  isFollowing = signal(true);

  private map!: L.Map;
  private polyline!: L.Polyline;
  private marker!: L.Marker;
  private isMapInitialized = signal(false);
  private ignoreInteraction = true;

  constructor(public uiService: UIService) {
    effect(() => {
      this.uiService.isFullScreen();
      if (this.isMapInitialized()) {
        this.ignoreInteraction = true;
        setTimeout(() => {
          this.map.invalidateSize();
          this.ignoreInteraction = false;
        }, 500);
      }
    });

    effect(() => {
      const point = this.currentPoint();
      if (point && this.isMapInitialized()) {
        const latLng: L.LatLngExpression = [point.lat, point.lng];
        
        this.marker.setLatLng(latLng);
        this.marker.setOpacity(1);

        if (point.activityId > 0) {
          this.polyline.addLatLng(latLng);
        }
        
        if (this.isFollowing()) {
          this.ignoreInteraction = true;
          if (point.activityId === 0 || this.polyline.getLatLngs().length <= 1) {
            this.map.setView(latLng, 16);
          } else {
            this.map.panTo(latLng);
          }
          // Resume detection after movement finishes
          setTimeout(() => this.ignoreInteraction = false, 500);
        }
      }
    });

    effect(() => {
      const coords = this.coordinates();
      if (coords.length > 0 && this.isMapInitialized()) {
        const latLngs = coords.map(c => [c.lat, c.lng] as L.LatLngExpression);
        this.polyline.setLatLngs(latLngs);
        try {
          this.ignoreInteraction = true;
          this.map.fitBounds(this.polyline.getBounds(), { padding: [20, 20] });
          this.isFollowing.set(true);
          setTimeout(() => this.ignoreInteraction = false, 1000);
        } catch (e) {}
        
        const last = coords[coords.length - 1];
        this.marker.setLatLng([last.lat, last.lng]);
        this.marker.setOpacity(1);
      }
    });
  }

  ngAfterViewInit() {
    this.initMap();
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
    }
  }

  recenter() {
    const point = this.currentPoint();
    const coords = this.coordinates();

    if (point) {
      this.ignoreInteraction = true;
      this.map.setView([point.lat, point.lng], 16);
      this.isFollowing.set(true);
      setTimeout(() => this.ignoreInteraction = false, 500);
    } else if (coords.length > 0) {
      this.ignoreInteraction = true;
      this.map.fitBounds(this.polyline.getBounds(), { padding: [20, 20] });
      this.isFollowing.set(true); // Treat fitting bounds as "following" the full track in history
      setTimeout(() => this.ignoreInteraction = false, 500);
    }
  }

  private initMap() {
    const iconDefault = L.icon({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      tooltipAnchor: [16, -28],
      shadowSize: [41, 41]
    });
    L.Marker.prototype.options.icon = iconDefault;

    this.map = L.map(this.mapContainer.nativeElement, {
      zoomControl: true,
      dragging: true,
      touchZoom: true
    }).setView([0, 0], 2);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.polyline = L.polyline([], { color: '#efbc21', weight: 6, opacity: 0.8 }).addTo(this.map);
    this.marker = L.marker([0, 0], { opacity: 0 }).addTo(this.map);

    // Detect user interaction with guard
    this.map.on('dragstart', () => {
      if (!this.ignoreInteraction) this.isFollowing.set(false);
    });
    this.map.on('zoomstart', () => {
      if (!this.ignoreInteraction) this.isFollowing.set(false);
    });

    this.isMapInitialized.set(true);

    // Initialization period: ignore automated movements
    setTimeout(() => {
      this.map.invalidateSize();
      const point = this.currentPoint();
      if (point) {
        this.ignoreInteraction = true;
        this.map.setView([point.lat, point.lng], 16);
        this.marker.setLatLng([point.lat, point.lng]);
        this.marker.setOpacity(1);
      }
      // Allow interaction detection after map is settled
      setTimeout(() => this.ignoreInteraction = false, 1000);
    }, 200);
  }
}
