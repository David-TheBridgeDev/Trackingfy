import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DatabaseService } from '../../services/database';
import { ActivityDetailComponent } from './activity-detail';

describe('ActivityDetailComponent', () => {
  let component: ActivityDetailComponent;
  let fixture: ComponentFixture<ActivityDetailComponent>;

  const mockDatabaseService = {
    getActivity: vi.fn().mockReturnValue(Promise.resolve(undefined)),
    getCoordinates: vi.fn().mockReturnValue(Promise.resolve([]))
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActivityDetailComponent],
      providers: [
        provideRouter([]),
        { provide: DatabaseService, useValue: mockDatabaseService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ActivityDetailComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
