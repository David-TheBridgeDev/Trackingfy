import { TestBed } from '@angular/core/testing';

import { UIService } from './ui';

describe('UIService', () => {
  let service: UIService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UIService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('prompt', () => {
    it('should resolve with the trimmed value that was typed', async () => {
      const answer = service.prompt({ title: 'Name' });

      service.promptValue.set('  Monte  ');
      service.resolvePrompt(service.promptValue());

      expect(await answer).toBe('Monte');
      expect(service.promptRequest()).toBeNull();
    });

    it('should resolve with null when it is dismissed or left empty', async () => {
      const dismissed = service.prompt({ title: 'Name' });
      service.resolvePrompt(null);
      expect(await dismissed).toBeNull();

      const blank = service.prompt({ title: 'Name' });
      service.resolvePrompt('   ');
      expect(await blank).toBeNull();
    });

    it('should seed the field with the value it was given', () => {
      void service.prompt({ title: 'Rename', value: 'Monte' });
      expect(service.promptValue()).toBe('Monte');
      service.resolvePrompt(null);
    });

    it('should not strand the caller of a prompt that is replaced by another', async () => {
      const first = service.prompt({ title: 'First' });
      const second = service.prompt({ title: 'Second' });

      expect(await first).toBeNull();

      service.resolvePrompt('Monte');
      expect(await second).toBe('Monte');
    });
  });

  describe('toast', () => {
    it('should run the action it was given and clear itself', () => {
      const run = vi.fn();
      service.showToast('Deleted', { label: 'Undo', run });

      expect(service.toast()?.text).toBe('Deleted');

      service.runToastAction();

      expect(run).toHaveBeenCalled();
      expect(service.toast()).toBeNull();
    });

    it('should hide a plain message on its own', () => {
      vi.useFakeTimers();
      service.showToast('Saved');

      vi.advanceTimersByTime(2500);
      expect(service.toast()).toBeNull();
      vi.useRealTimers();
    });

    it('should leave a message with an action on screen for longer', () => {
      vi.useFakeTimers();
      service.showToast('Deleted', { label: 'Undo', run: vi.fn() });

      vi.advanceTimersByTime(2500);
      expect(service.toast()).not.toBeNull();

      vi.advanceTimersByTime(4000);
      expect(service.toast()).toBeNull();
      vi.useRealTimers();
    });
  });
});
