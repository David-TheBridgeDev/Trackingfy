import { TestBed } from '@angular/core/testing';
import {
  ACTIVITY_TYPES,
  ActivityTypeService,
  DEFAULT_ACTIVITY_TYPE,
  activityTypeIcon,
  isActivityType,
} from './activity-types';

const STORAGE_KEY = 'trackingfy_activity_type';

describe('activity types', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  describe('isActivityType', () => {
    it('accepts the three recordable activities', () => {
      for (const type of ACTIVITY_TYPES) {
        expect(isActivityType(type)).toBe(true);
      }
    });

    it('rejects anything else, including the shapes localStorage can return', () => {
      expect(isActivityType('Swimming')).toBe(false);
      expect(isActivityType('cycling')).toBe(false);
      expect(isActivityType(null)).toBe(false);
      expect(isActivityType(undefined)).toBe(false);
      expect(isActivityType(3)).toBe(false);
    });
  });

  describe('activityTypeIcon', () => {
    it('gives each activity its own icon', () => {
      const icons = ACTIVITY_TYPES.map(activityTypeIcon);
      expect(new Set(icons).size).toBe(ACTIVITY_TYPES.length);
    });

    it('walks anything it does not recognise, for routes recorded before the types', () => {
      expect(activityTypeIcon('Activity')).toBe(activityTypeIcon('Walking'));
      expect(activityTypeIcon('')).toBe(activityTypeIcon('Walking'));
    });
  });

  // Asserted as the literal rather than against the constant: comparing the constant
  // with itself would pass whatever it was changed to, and this is the value a fresh
  // install records -- the one every route carried before the type could be chosen.
  it('defaults to cycling', () => {
    expect(DEFAULT_ACTIVITY_TYPE).toBe('Cycling');
  });

  describe('ActivityTypeService', () => {
    it('starts on cycling when nothing has been chosen', () => {
      expect(TestBed.inject(ActivityTypeService).current()).toBe('Cycling');
    });

    it('remembers the choice across a restart', () => {
      TestBed.inject(ActivityTypeService).select('Running');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('Running');

      TestBed.resetTestingModule();
      expect(TestBed.inject(ActivityTypeService).current()).toBe('Running');
    });

    it('falls back to the default when the stored value is not a type', () => {
      // A hand-edited or outgrown value must not leave routes filed as nonsense.
      localStorage.setItem(STORAGE_KEY, 'Swimming');
      expect(TestBed.inject(ActivityTypeService).current()).toBe(DEFAULT_ACTIVITY_TYPE);
    });

    it('still works when storage is refused, as in private browsing', () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('denied');
      });
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied');
      });

      try {
        const service = TestBed.inject(ActivityTypeService);
        expect(service.current()).toBe(DEFAULT_ACTIVITY_TYPE);
        expect(() => service.select('Walking')).not.toThrow();
        expect(service.current()).toBe('Walking');
      } finally {
        setItem.mockRestore();
        getItem.mockRestore();
      }
    });
  });
});
