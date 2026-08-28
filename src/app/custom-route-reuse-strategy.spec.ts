import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, DetachedRouteHandle } from '@angular/router';
import { CustomRouteReuseStrategy } from './custom-route-reuse-strategy';
import { UIService } from './services/ui';

describe('CustomRouteReuseStrategy', () => {
  let strategy: CustomRouteReuseStrategy;
  let uiService: UIService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CustomRouteReuseStrategy, UIService]
    });
    strategy = TestBed.inject(CustomRouteReuseStrategy);
    uiService = TestBed.inject(UIService);
  });

  it('should detach route when path is history', () => {
    const route = {
      routeConfig: { path: 'history' },
      data: {}
    } as unknown as ActivatedRouteSnapshot;

    expect(strategy.shouldDetach(route)).toBe(true);
  });

  it('should detach route when data.reuse is true', () => {
    const route = {
      routeConfig: { path: 'custom-path' },
      data: { reuse: true }
    } as unknown as ActivatedRouteSnapshot;

    expect(strategy.shouldDetach(route)).toBe(true);
  });

  it('should not detach routes that do not match history or reuse flag', () => {
    const route = {
      routeConfig: { path: 'activity/:id' },
      data: {}
    } as unknown as ActivatedRouteSnapshot;

    expect(strategy.shouldDetach(route)).toBe(false);
  });

  it('should store and attach detached route handle', () => {
    const route = {
      routeConfig: { path: 'history' },
      data: { reuse: true }
    } as unknown as ActivatedRouteSnapshot;

    const mockHandle = {} as DetachedRouteHandle;

    expect(strategy.shouldAttach(route)).toBe(false);
    expect(strategy.retrieve(route)).toBeNull();

    strategy.store(route, mockHandle);

    expect(strategy.shouldAttach(route)).toBe(true);
    expect(strategy.retrieve(route)).toBe(mockHandle);
  });

  it('should delete stored route handle when stored with null', () => {
    const route = {
      routeConfig: { path: 'history' },
      data: { reuse: true }
    } as unknown as ActivatedRouteSnapshot;

    const mockHandle = {} as DetachedRouteHandle;
    strategy.store(route, mockHandle);
    expect(strategy.shouldAttach(route)).toBe(true);

    strategy.store(route, null);
    expect(strategy.shouldAttach(route)).toBe(false);
    expect(strategy.retrieve(route)).toBeNull();
  });

  it('should reuse route when future and current route configs match', () => {
    const config = { path: 'history' };
    const future = { routeConfig: config } as unknown as ActivatedRouteSnapshot;
    const curr = { routeConfig: config } as unknown as ActivatedRouteSnapshot;

    expect(strategy.shouldReuseRoute(future, curr)).toBe(true);
  });
});
