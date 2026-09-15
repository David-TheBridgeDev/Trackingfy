import { TestBed } from '@angular/core/testing';
import { Activity, DatabaseService } from './database';
import { RouteNavigationService } from './route-navigation';

function makeActivity(id: number, finished = true): Activity {
  const start = 1_700_000_000_000 + id * 1000;
  return {
    id,
    date: new Date(start),
    type: 'Cycling',
    totalDistance: 1000,
    totalTime: 600,
    avgSpeed: 1.6,
    totalClimb: 10,
    totalDescent: 10,
    startTime: start,
    ...(finished ? { endTime: start + 600000 } : {}),
  };
}

describe('RouteNavigationService', () => {
  let service: RouteNavigationService;

  const mockDatabaseService = {
    getActivities: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseService.getActivities.mockResolvedValue([
      makeActivity(7),
      makeActivity(8, false),
      makeActivity(9),
    ]);

    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: mockDatabaseService }],
    });

    service = TestBed.inject(RouteNavigationService);
  });

  it('should say what comes either side of a route', () => {
    service.setSequence([1, 2, 3], 'Monte');

    expect(service.neighbours(2)).toEqual({
      index: 1,
      total: 3,
      previousId: 1,
      nextId: 3,
    });
    expect(service.label()).toBe('Monte');
  });

  it('should have nothing beyond the ends of the list', () => {
    service.setSequence([1, 2, 3]);

    expect(service.neighbours(1).previousId).toBeNull();
    expect(service.neighbours(3).nextId).toBeNull();
  });

  it('should report a route that is not in the list as being nowhere in it', () => {
    service.setSequence([1, 2, 3]);

    const neighbours = service.neighbours(99);
    expect(neighbours.index).toBe(-1);
    expect(neighbours.previousId).toBeNull();
    expect(neighbours.nextId).toBeNull();
  });

  it('should handle a route with no id at all', () => {
    service.setSequence([1, 2, 3]);
    expect(service.neighbours(undefined).index).toBe(-1);
  });

  it('should close the gap left by a deleted route', () => {
    service.setSequence([1, 2, 3]);

    service.remove(2);

    expect(service.sequence()).toEqual([1, 3]);
    expect(service.neighbours(1).nextId).toBe(3);
  });

  it('should fall back to the finished routes of the history when it has no list', async () => {
    await service.ensureContains(9, 'History');

    expect(service.sequence()).toEqual([7, 9]);
    expect(service.label()).toBe('History');
  });

  it('should keep the list it was given instead of reading the database again', async () => {
    service.setSequence([4, 5, 6], 'Monte');

    await service.ensureContains(5);

    expect(mockDatabaseService.getActivities).not.toHaveBeenCalled();
    expect(service.sequence()).toEqual([4, 5, 6]);
    expect(service.label()).toBe('Monte');
  });

  it('should read the database once when two screens ask at the same time', async () => {
    await Promise.all([service.ensureContains(7), service.ensureContains(9)]);

    expect(mockDatabaseService.getActivities).toHaveBeenCalledTimes(1);
  });

  it('should forget the list on demand', () => {
    service.setSequence([1, 2], 'Monte');

    service.clear();

    expect(service.sequence()).toEqual([]);
    expect(service.label()).toBeNull();
  });
});
