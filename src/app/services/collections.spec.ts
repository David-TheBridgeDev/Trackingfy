import { TestBed } from '@angular/core/testing';
import { Collection, DatabaseService } from './database';
import { CollectionsService } from './collections';

describe('CollectionsService', () => {
  let service: CollectionsService;
  let stored: Collection[];

  const mockDatabaseService = {
    getCollections: vi.fn(),
    addCollection: vi.fn(),
    updateCollection: vi.fn(),
    deleteCollection: vi.fn(),
    saveCollectionOrder: vi.fn(),
    assignCollection: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    stored = [
      { id: 1, name: 'Monte', color: '#efbc21', order: 0, createdAt: 1 },
      { id: 2, name: 'Caminata', color: '#f97316', order: 1, createdAt: 2 },
    ];

    mockDatabaseService.getCollections.mockImplementation(async () =>
      [...stored].sort((a, b) => a.order - b.order),
    );
    mockDatabaseService.addCollection.mockImplementation(async (collection: Collection) => {
      const id = stored.length + 10;
      stored.push({ ...collection, id });
      return id;
    });
    mockDatabaseService.updateCollection.mockImplementation(
      async (id: number, changes: Partial<Collection>) => {
        stored = stored.map((c) => (c.id === id ? { ...c, ...changes } : c));
        return 1;
      },
    );
    mockDatabaseService.deleteCollection.mockImplementation(async (id: number) => {
      stored = stored.filter((c) => c.id !== id);
    });
    mockDatabaseService.saveCollectionOrder.mockImplementation(async (ids: number[]) => {
      stored = stored.map((c) => ({ ...c, order: ids.indexOf(c.id!) }));
    });

    TestBed.configureTestingModule({
      providers: [{ provide: DatabaseService, useValue: mockDatabaseService }],
    });

    service = TestBed.inject(CollectionsService);
    await service.load();
  });

  it('should load the collections in their stored order', () => {
    expect(service.collections().map((c) => c.name)).toEqual(['Monte', 'Caminata']);
  });

  it('should create a collection at the end of the bar with an unused colour', async () => {
    const result = await service.create('Entreno');

    expect(result.kind).toBe('created');
    expect(mockDatabaseService.addCollection).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Entreno', order: 2 }),
    );
    expect(service.collections().map((c) => c.name)).toContain('Entreno');

    const colors = service.collections().map((c) => c.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('should hand back the existing collection instead of a second one with the same name', async () => {
    const result = await service.create('  monte ');

    expect(result).toEqual({ kind: 'duplicate', collection: stored[0] });
    expect(mockDatabaseService.addCollection).not.toHaveBeenCalled();
  });

  it('should refuse a name that is only whitespace', async () => {
    expect(await service.create('   ')).toEqual({ kind: 'invalid' });
  });

  it('should rename a collection, but not onto the name of another one', async () => {
    expect(await service.rename(2, 'Senderismo')).toBe(true);
    expect(service.collections().find((c) => c.id === 2)?.name).toBe('Senderismo');

    expect(await service.rename(2, 'Monte')).toBe(false);
    expect(service.collections().find((c) => c.id === 2)?.name).toBe('Senderismo');
  });

  it('should keep a rename that only changes the casing of its own name', async () => {
    expect(await service.rename(1, 'MONTE')).toBe(true);
    expect(service.collections().find((c) => c.id === 1)?.name).toBe('MONTE');
  });

  it('should swap two collections when one is moved along the bar', async () => {
    await service.move(2, -1);

    expect(mockDatabaseService.saveCollectionOrder).toHaveBeenCalledWith([2, 1]);
    expect(service.collections().map((c) => c.name)).toEqual(['Caminata', 'Monte']);
  });

  it('should ignore a move that would fall off either end', async () => {
    await service.move(1, -1);
    await service.move(2, 1);

    expect(mockDatabaseService.saveCollectionOrder).not.toHaveBeenCalled();
  });

  it('should drop a collection from the list once removed', async () => {
    await service.remove(1);

    expect(mockDatabaseService.deleteCollection).toHaveBeenCalledWith(1);
    expect(service.collections().map((c) => c.id)).toEqual([2]);
  });

  it('should look a collection up by id, and report none for an unknown one', () => {
    expect(service.nameOf(1)).toBe('Monte');
    expect(service.nameOf(404)).toBeNull();
    expect(service.nameOf(undefined)).toBeNull();
  });
});
