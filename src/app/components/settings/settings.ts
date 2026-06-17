import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UIService } from '../../services/ui';
import { TranslationService } from '../../services/translation';
import { TrackingService } from '../../services/tracking';

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

  ngOnInit() {
    this.uiService.setFullScreen(false);
  }
}
