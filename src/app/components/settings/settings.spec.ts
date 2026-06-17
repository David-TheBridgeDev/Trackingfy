import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsComponent } from './settings';
import { TrackingService } from '../../services/tracking';
import { signal } from '@angular/core';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;

  const mockTrackingService = {
    activityTypes: ['Cycling', 'Running', 'Walking'],
    selectedActivityType: signal('Cycling'),
    setSelectedActivityType: vi.fn()
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: TrackingService, useValue: mockTrackingService },
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
