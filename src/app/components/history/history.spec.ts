import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DatabaseService } from '../../services/database';
import { HistoryComponent } from './history';

describe('HistoryComponent', () => {
  let component: HistoryComponent;
  let fixture: ComponentFixture<HistoryComponent>;

  const mockDatabaseService = {
    getActivities: vi.fn().mockReturnValue(Promise.resolve([]))
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoryComponent],
      providers: [
        provideRouter([]),
        { provide: DatabaseService, useValue: mockDatabaseService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HistoryComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should enter selection mode and select an activity', () => {
    component.enterSelectionMode(1);
    expect(component.isSelectionMode()).toBe(true);
    expect(component.selectedIds().has(1)).toBe(true);
  });

  it('should toggle selection and exit mode when no items are selected', () => {
    component.enterSelectionMode(1);
    component.toggleSelection(1);
    expect(component.isSelectionMode()).toBe(false);
    expect(component.selectedIds().size).toBe(0);
  });

  it('should select all items and then exit selection mode', () => {
    component.enterSelectionMode(1);
    component.toggleSelection(2);
    expect(component.selectedIds().size).toBe(2);
    component.exitSelectionMode();
    expect(component.isSelectionMode()).toBe(false);
    expect(component.selectedIds().size).toBe(0);
  });

  it('should filter out activities that do not have an endTime', async () => {
    const mockActivities = [
      { id: 1, date: new Date(), type: 'Cycling', totalDistance: 1000, totalTime: 300, avgSpeed: 3.3, totalClimb: 10, totalDescent: 10, startTime: Date.now() - 300000, endTime: Date.now() },
      { id: 2, date: new Date(), type: 'Running', totalDistance: 500, totalTime: 150, avgSpeed: 3.3, totalClimb: 5, totalDescent: 5, startTime: Date.now() - 150000 } // Active, no endTime
    ];
    mockDatabaseService.getActivities.mockReturnValue(Promise.resolve(mockActivities));

    await component.loadActivities();

    expect(component.activities().length).toBe(1);
    expect(component.activities()[0].id).toBe(1);
  });
});
