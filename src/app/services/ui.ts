import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class UIService {
  isFullScreen = signal<boolean>(false);

  toggleFullScreen() {
    this.isFullScreen.update(v => !v);
  }

  setFullScreen(value: boolean) {
    this.isFullScreen.set(value);
  }
}
