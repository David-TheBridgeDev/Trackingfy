import { Component, OnInit, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UIService } from '../../services/ui';
import { TranslationService } from '../../services/translation';
import { TrackingService } from '../../services/tracking';
import { DatabaseService } from '../../services/database';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { App } from '../../app';

@Component({
  selector: 'app-settings',
  imports: [CommonModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsComponent implements OnInit {
  public uiService = inject(UIService);
  public ts = inject(TranslationService);
  public trackingService = inject(TrackingService);
  public db = inject(DatabaseService);
  private appComponent = inject(App);

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  ngOnInit() {
    this.uiService.setFullScreen(false);
  }

  async exportData() {
    try {
      const data = await this.db.exportData();
      const fileName = `trackingfy_backup_${new Date().toISOString().split('T')[0]}.json`;

      if (Capacitor.isNativePlatform()) {
        const result = await Filesystem.writeFile({
          path: fileName,
          data: data,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        await Share.share({
          title: 'Trackingfy Backup',
          url: result.uri,
        });
      } else {
        const blob = new Blob([data], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export error:', error);
    }
  }

  triggerImport() {
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const text = e.target?.result as string;
          await this.db.importData(text);
          // Show success toast (we can use App component's triggerToast or create a public method)
          // Actually App component has showToast and toastMessage, but triggerToast is private. Let's make it public in App.
          // Wait, we can just use alert or we can call App component's triggerToast if we change it to public.
          alert(this.ts.t('settings.backup.success'));
        } catch (err) {
          console.error(err);
          alert(this.ts.t('settings.backup.error'));
        }
      };
      reader.readAsText(file);
    }
    // Reset the input so the same file can be imported again if needed
    event.target.value = '';
  }
}
