import { Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ACTIVITY_TYPES, ActivityType, activityTypeIcon } from '../../services/activity-types';
import { TranslationService } from '../../services/translation';

/**
 * The sheet that says what a route was recorded doing.
 *
 * The type is chosen on the dashboard before a recording, but it is the one thing about
 * a route that is easy to get wrong -- the dashboard was left on "cycling" and the walk
 * went in as a ride -- so the detail view offers the same three choices to correct it
 * afterwards, rather than making the route a lost cause.
 */
@Component({
  selector: 'app-activity-type-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './activity-type-picker.html',
  styleUrl: './activity-type-picker.css',
})
export class ActivityTypePickerComponent {
  public ts = inject(TranslationService);

  /** The type the route carries now, marked as the current one in the list. */
  current = input<string | null>(null);

  picked = output<ActivityType>();
  closed = output<void>();

  readonly types = ACTIVITY_TYPES;

  label(type: ActivityType): string {
    return this.ts.t(`activity.${type}`);
  }

  icon(type: ActivityType): string {
    return activityTypeIcon(type);
  }
}
