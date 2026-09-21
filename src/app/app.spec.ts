import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { UIService } from './services/ui';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Trackingfy');
  });

  describe('escape', () => {
    let ui: UIService;
    let app: App;

    beforeEach(async () => {
      const fixture = TestBed.createComponent(App);
      app = fixture.componentInstance;
      ui = TestBed.inject(UIService);
      await fixture.whenStable();
    });

    it('cancels a prompt', async () => {
      const answer = ui.prompt({ title: 'Name' });
      app.onEscape();

      await expect(answer).resolves.toBeNull();
      expect(ui.promptRequest()).toBeNull();
    });

    it('answers no to a confirmation', async () => {
      const answer = ui.confirm({ title: 'Delete', message: 'Sure?' });
      app.onEscape();

      await expect(answer).resolves.toBe(false);
      expect(ui.confirmation()).toBeNull();
    });

    // A prompt opened over a confirmation is the one on top, so it goes first.
    it('closes the prompt before the confirmation underneath it', async () => {
      const confirmed = ui.confirm({ title: 'Delete', message: 'Sure?' });
      const named = ui.prompt({ title: 'Name' });

      app.onEscape();
      await expect(named).resolves.toBeNull();
      expect(ui.confirmation()).not.toBeNull();

      app.onEscape();
      await expect(confirmed).resolves.toBe(false);
    });

    it('does nothing when no dialog is open', () => {
      expect(() => app.onEscape()).not.toThrow();
    });
  });
});
