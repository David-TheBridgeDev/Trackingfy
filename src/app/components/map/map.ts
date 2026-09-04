import { Component, input, output, effect, ElementRef, ViewChild, AfterViewInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as L from 'leaflet';
import { Coordinate } from '../../services/database';
import { UIService } from '../../services/ui';
import { TrackingService } from '../../services/tracking';

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="relative w-full h-full">
      <div #mapContainer class="w-full h-full"></div>
      
      <!-- GPS Location Button (Google Maps/Waze style) -->
      @if (showLocationButton()) {
        <button 
          (click)="recenter()"
          [class]="'absolute bottom-40 right-4 w-12 h-12 flex items-center justify-center rounded-full shadow-2xl border transition-all active:scale-90 z-[1000] ' + 
                   (trackingService.permissionDenied() || !currentPoint() ? 'bg-red-500 text-pure-white border-red-400 animate-pulse' : 
                   (isFollowing() ? 'bg-accent text-pure-white border-accent' : 'bg-white/95 text-gray-700 border-gray-100'))"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M3 12h3m12 0h3M12 3v3m0 12v3" />
          </svg>
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
  referenceCoordinates = input<Coordinate[]>([]);
  currentPoint = input<Coordinate | null>(null);
  showLocationButton = input<boolean>(true);
  enablePan = input<boolean>(true);

  /** When true, tapping the map emits a point instead of just panning. */
  editMode = input<boolean>(false);
  /** Points being drawn by the user, not yet saved. */
  draftPoints = input<{ lat: number; lng: number }[]>([]);

  mapClick = output<{ lat: number; lng: number }>();

  isFollowing = signal(true);

  private map!: L.Map;
  private polyline!: L.Polyline;
  private manualPolyline!: L.Polyline;
  private referencePolyline!: L.Polyline;
  private draftPolyline!: L.Polyline;
  private draftMarkers!: L.LayerGroup;
  private anchorMarker!: L.CircleMarker;
  private marker!: L.Marker;
  private isMapInitialized = signal(false);
  private ignoreInteraction = true;

  constructor(public uiService: UIService, public trackingService: TrackingService) {
    // Clear map when tracking stops
    effect(() => {
      const state = this.trackingService.state();
      if (state === 'idle' && this.isMapInitialized()) {
        this.polyline.setLatLngs([]);
      }
    });

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

        if (point.activityId > 0 && this.coordinates().length === 0) {
          this.polyline.addLatLng(latLng);
        }
        
        if (this.isFollowing() && this.enablePan()) {
          this.ignoreInteraction = true;
          if (point.activityId === 0 || (this.coordinates().length === 0 && this.polyline.getLatLngs().length <= 1)) {
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
        const { recorded, manual } = this.splitBySource(coords);
        this.polyline.setLatLngs(recorded);
        this.manualPolyline.setLatLngs(manual);
        
        if (!this.showLocationButton()) {
          try {
            this.ignoreInteraction = true;
            this.map.fitBounds(this.polyline.getBounds(), { padding: [20, 20] });
            this.isFollowing.set(true);
            setTimeout(() => this.ignoreInteraction = false, 1000);
          } catch (e) {}
        }
        
        const last = coords[coords.length - 1];
        this.marker.setLatLng([last.lat, last.lng]);
        this.marker.setOpacity(1);

        if (this.showLocationButton() && this.isFollowing() && this.enablePan()) {
          this.ignoreInteraction = true;
          this.map.panTo([last.lat, last.lng]);
          setTimeout(() => this.ignoreInteraction = false, 500);
        }
      }
    });

    effect(() => {
      const coords = this.referenceCoordinates();
      if (this.isMapInitialized()) {
        if (coords.length > 0) {
          const latLngs = coords.map(c => [c.lat, c.lng] as L.LatLngExpression);
          this.referencePolyline.setLatLngs(latLngs);
        } else {
          this.referencePolyline.setLatLngs([]);
        }
      }
    });

    effect(() => {
      const draft = this.draftPoints();
      const editing = this.editMode();
      const coords = this.coordinates();

      if (!this.isMapInitialized()) return;

      if (!editing || draft.length === 0) {
        this.draftPolyline.setLatLngs([]);
        this.draftMarkers.clearLayers();
      } else {
        // The drawn segment always ends at the first recorded fix, so the user can see
        // exactly where their reconstruction joins the real track.
        const anchor = coords[0];
        const path = draft.map(p => [p.lat, p.lng] as L.LatLngExpression);
        if (anchor) path.push([anchor.lat, anchor.lng]);
        this.draftPolyline.setLatLngs(path);

        this.draftMarkers.clearLayers();
        draft.forEach((p, i) => {
          L.circleMarker([p.lat, p.lng], {
            radius: 5,
            color: '#ffffff',
            weight: 2,
            fillColor: i === 0 ? '#16a34a' : '#f97316',
            fillOpacity: 1
          }).addTo(this.draftMarkers);
        });
      }

      const anchor = coords[0];
      if (editing && anchor) {
        this.anchorMarker.setLatLng([anchor.lat, anchor.lng]);
        this.anchorMarker.setStyle({ opacity: 1, fillOpacity: 0.9 });
      } else {
        this.anchorMarker.setStyle({ opacity: 0, fillOpacity: 0 });
      }
    });
  }

  /**
   * Separate the hand-drawn opening of a route from the recorded part, so each can be
   * drawn in its own style. The manual run keeps the first recorded point so the two
   * polylines meet instead of leaving a visual gap.
   */
  private splitBySource(coords: Coordinate[]): { recorded: L.LatLngExpression[]; manual: L.LatLngExpression[] } {
    const toLatLng = (c: Coordinate) => [c.lat, c.lng] as L.LatLngExpression;

    let manualCount = 0;
    while (manualCount < coords.length && coords[manualCount].source === 'manual') {
      manualCount++;
    }

    if (manualCount === 0) {
      return { recorded: coords.map(toLatLng), manual: [] };
    }

    return {
      recorded: coords.slice(manualCount).map(toLatLng),
      manual: coords.slice(0, Math.min(manualCount + 1, coords.length)).map(toLatLng)
    };
  }

  ngAfterViewInit() {
    this.initMap();
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
    }
  }

  async recenter() {
    let point = this.currentPoint();
    
    // If we don't have a point, it might be because permissions weren't granted or GPS is off.
    // We try to request/activate it.
    if (!point) {
      const granted = await this.trackingService.requestPermission();
      if (granted) {
        point = this.currentPoint();
      }
    }

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
      zoomControl: false,
      dragging: true,
      touchZoom: true
    }).setView([0, 0], 2);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.polyline = L.polyline([], { color: 'red', weight: 6, opacity: 0.8 }).addTo(this.map);
    // Hand-drawn stretches are dashed so a reconstructed opening is never mistaken for
    // something the GPS actually recorded.
    this.manualPolyline = L.polyline([], { color: '#f97316', weight: 6, opacity: 0.85, dashArray: '2, 12', lineCap: 'round' }).addTo(this.map);
    this.referencePolyline = L.polyline([], { color: 'blue', weight: 4, opacity: 0.6, dashArray: '5, 10' }).addTo(this.map);
    this.draftPolyline = L.polyline([], { color: '#f97316', weight: 4, opacity: 0.9, dashArray: '6, 8' }).addTo(this.map);
    this.draftMarkers = L.layerGroup().addTo(this.map);
    this.anchorMarker = L.circleMarker([0, 0], {
      radius: 7,
      color: '#ffffff',
      weight: 3,
      fillColor: '#ef4444',
      fillOpacity: 0,
      opacity: 0
    }).addTo(this.map);
    this.marker = L.marker([0, 0], { opacity: 0 }).addTo(this.map);

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.editMode()) {
        this.mapClick.emit({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

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
