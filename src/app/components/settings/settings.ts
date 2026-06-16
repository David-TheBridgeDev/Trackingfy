import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UIService } from '../../services/ui';
import { TranslationService } from '../../services/translation';

@Component({
  selector: 'app-settings',
  imports: [CommonModule],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsComponent implements OnInit {
  public uiService = inject(UIService);
  public ts = inject(TranslationService);

  ngOnInit() {
    this.uiService.setFullScreen(false);
  }
}
