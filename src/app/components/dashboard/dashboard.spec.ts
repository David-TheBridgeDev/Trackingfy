import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TrackingService } from '../../services/tracking';
import { DashboardComponent } from './dashboard';
import { provideRouter } from '@angular/router';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  const mockTrackingService = {
    state: signal('idle'),
    currentDistance: signal(0),
    currentTime: signal(0),
    currentSpeed: signal(0),
    currentClimb: signal(0),
    currentDescent: signal(0),
    lastCoordinate: signal(null),
    permissionDenied: signal(false),
    startTracking: vi.fn(),
    stopTracking: vi.fn(),
    pauseTracking: vi.fn(),
    resumeTracking: vi.fn()
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: TrackingService, useValue: mockTrackingService },
        provideRouter([])
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
