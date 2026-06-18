import { Component, OnInit, signal, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatabaseService, Activity, Coordinate } from '../../services/database';
import { MapComponent } from '../map/map';
import { UIService } from '../../services/ui';
import { TranslationService } from '../../services/translation';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import html2canvas from 'html2canvas';

@Component({
  selector: 'app-activity-detail',
  imports: [CommonModule, MapComponent, RouterLink],
  templateUrl: './activity-detail.html',
})
export class ActivityDetailComponent implements OnInit {
  @ViewChild('exportContainer') exportContainer!: ElementRef;
  
  activity = signal<Activity | null>(null);
  coordinates = signal<Coordinate[]>([]);
  isGeneratingSticker = signal(false);

  svgViewBox = signal<string>('0 0 100 100');
  svgPath = signal<string>('');
  svgStrokeWidth = signal<number>(0.001);

  constructor(
    private route: ActivatedRoute,
    private db: DatabaseService,
    public uiService: UIService,
    public ts: TranslationService
  ) {}

  async ngOnInit() {
    this.uiService.setFullScreen(false); // Reset FS when entering
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      const act = await this.db.getActivity(id);
      this.activity.set(act || null);
      const coords = await this.db.getCoordinates(id);
      this.coordinates.set(coords);

      if (coords.length > 0) {
        const lats = coords.map(c => c.lat);
        const lngs = coords.map(c => c.lng);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        
        const latRange = maxLat - minLat;
        const lngRange = maxLng - minLng;
        const padding = Math.max(latRange, lngRange) * 0.1 || 0.01;
        
        const vbMinX = minLng - padding;
        const vbMinY = -(maxLat + padding);
        const vbWidth = (maxLng - minLng) + padding * 2;
        const vbHeight = (maxLat - minLat) + padding * 2;
        
        this.svgViewBox.set(`${vbMinX} ${vbMinY} ${vbWidth} ${vbHeight}`);
        this.svgStrokeWidth.set(Math.max(vbWidth, vbHeight) * 0.01); // 1% of the view box
        
        const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.lng} ${-c.lat}`).join(' ');
        this.svgPath.set(path);
      }
    }
  }

  formatTime(seconds: number | undefined): string {
    if (seconds === undefined) return '0m 0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
  }

  formatPace(speed: number | undefined): string {
    if (!speed || !isFinite(speed) || speed === 0) return '--:-- /km';
    const pace = (1000 / speed) / 60;
    if (pace > 60) return '--:-- /km';
    const m = Math.floor(pace);
    const s = Math.floor((pace - m) * 60);
    return `${m}:${s < 10 ? '0' + s : s} /km`;
  }

  formatMaxSpeed(speed: number | undefined): string {
    if (!speed) return '0.0 km/h';
    return (speed * 3.6).toFixed(1) + ' km/h';
  }

  formatMaxGrade(grade: number | undefined): string {
    if (grade === undefined || grade === null) return '0%';
    return grade.toFixed(1) + '%';
  }

  formatMinGrade(grade: number | undefined): string {
    if (grade === undefined || grade === null) return '0%';
    return grade.toFixed(1) + '%';
  }

  async shareSticker() {
    if (!this.exportContainer) return;
    this.isGeneratingSticker.set(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 100));

      const canvas = await html2canvas(this.exportContainer.nativeElement, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: null, // Keep transparent or background from css
        scale: 1 // No need to upscale, we are exporting a 1080x1080 block
      });

      const dataUrl = canvas.toDataURL('image/png'); // Export as PNG
      const fileName = `trackingfy-route-${Date.now()}.png`;

      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: dataUrl,
        directory: Directory.Cache
      });

      await Share.share({
        title: this.ts.t('share.title'),
        text: this.ts.t('share.text'),
        url: savedFile.uri,
        dialogTitle: this.ts.t('share.dialog_title')
      });
    } catch (e) {
      console.error('Error generating or sharing sticker', e);
    } finally {
      this.isGeneratingSticker.set(false);
    }
  }
}
