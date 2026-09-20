import { Injectable, signal } from '@angular/core';

/**
 * What was being done while the route was recorded.
 *
 * The history filters by it, the statistics break the kilometres down by it, and the
 * route editor uses it to decide whether a hand-drawn stretch implies a plausible speed,
 * so it is a real dimension of the data rather than a label.
 */
export type ActivityType = 'Walking' | 'Running' | 'Cycling';

/** Offered in the order they are ordinarily reached: slowest first. */
export const ACTIVITY_TYPES: readonly ActivityType[] = ['Walking', 'Running', 'Cycling'];

/** What a recording is when nothing has been chosen, and what every route was before. */
export const DEFAULT_ACTIVITY_TYPE: ActivityType = 'Cycling';

const STORAGE_KEY = 'trackingfy_activity_type';

export function isActivityType(value: unknown): value is ActivityType {
  return typeof value === 'string' && (ACTIVITY_TYPES as readonly string[]).includes(value);
}

/**
 * The icon that stands for an activity, as a mask URL.
 *
 * Masks rather than images so the icon takes the colour of whatever draws it -- the
 * accent on a card, the ink on an accent-filled chip -- instead of shipping one file per
 * colour. Anything unrecognised walks: older routes carry free-form type strings.
 */
export function activityTypeIcon(type: string): string {
  switch (type) {
    case 'Cycling':
      return 'icons/bike.svg';
    case 'Running':
      return 'icons/running.svg';
    default:
      return 'icons/walking.svg';
  }
}

/**
 * The activity the next recording will be filed as.
 *
 * It is one value, not a default plus a session choice: picking "running" on the
 * dashboard is also the answer to "what do you usually do", and a separate default
 * would only be a second thing to keep in agreement with the first. Settings edits the
 * same signal, which is why it is described there as the default.
 */
@Injectable({ providedIn: 'root' })
export class ActivityTypeService {
  readonly current = signal<ActivityType>(readStoredType());

  select(type: ActivityType) {
    this.current.set(type);
    try {
      localStorage.setItem(STORAGE_KEY, type);
    } catch {
      // Private browsing can refuse storage; the choice simply lasts this session.
    }
  }
}

function readStoredType(): ActivityType {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isActivityType(stored) ? stored : DEFAULT_ACTIVITY_TYPE;
  } catch {
    return DEFAULT_ACTIVITY_TYPE;
  }
}
