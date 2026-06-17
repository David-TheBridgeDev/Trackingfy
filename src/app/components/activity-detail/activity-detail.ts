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
  @ViewChild('stickerContainer') stickerContainer!: ElementRef;
  
  activity = signal<Activity | null>(null);
  coordinates = signal<Coordinate[]>([]);
  isGeneratingSticker = signal(false);

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

  async shareSticker() {
    if (!this.stickerContainer) return;
    this.isGeneratingSticker.set(true);

    try {
      // Small delay to allow Angular to render any states if needed
      await new Promise(resolve => setTimeout(resolve, 100));

      const canvas = await html2canvas(this.stickerContainer.nativeElement, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#f8f9fa', // fallback background
        scale: 2 // High resolution
      });

      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const fileName = `trackingfy-route-${Date.now()}.jpg`;

      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: dataUrl,
        directory: Directory.Cache
      });

      await Share.share({
        title: 'Mi ruta en Trackingfy',
        text: '¡Mira mi ruta en Trackingfy!',
        url: savedFile.uri,
        dialogTitle: 'Compartir ruta'
      });
    } catch (e) {
      console.error('Error generating or sharing sticker', e);
    } finally {
      this.isGeneratingSticker.set(false);
    }
  }
}
