import { TestBed } from '@angular/core/testing';
import { TrackingService } from './tracking';
import { DatabaseService } from './database';

describe('TrackingService', () => {
  let service: TrackingService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TrackingService,
        { provide: DatabaseService, useValue: { addActivity: () => Promise.resolve(1) } }
      ]
    });
    service = TestBed.inject(TrackingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should calculate distance correctly (Haversine)', () => {
    // Madrid to Barcelona (approx 504km)
    const madrid = { lat: 40.4168, lng: -3.7038 };
    const barcelona = { lat: 41.3851, lng: 2.1734 };
    
    // Using any to access private method for testing
    const distance = (service as any).calculateDistance(madrid.lat, madrid.lng, barcelona.lat, barcelona.lng);
    
    // Distance should be approx 504,000 meters
    expect(distance).toBeGreaterThan(500000);
    expect(distance).toBeLessThan(510000);
  });
});
