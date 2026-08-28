import { inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, DetachedRouteHandle, RouteReuseStrategy } from '@angular/router';
import { UIService } from './services/ui';

@Injectable({
  providedIn: 'root',
})
export class CustomRouteReuseStrategy implements RouteReuseStrategy {
  private uiService = inject(UIService);
  private storedRoutes = new Map<string, DetachedRouteHandle>();

  private getScrollContainer(): HTMLElement | null {
    return (
      document.getElementById('main-scroll-container') ||
      document.querySelector('main > div.overflow-y-auto')
    );
  }

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return route.data?.['reuse'] === true || route.routeConfig?.path === 'history';
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const key = this.getRouteKey(route);
    if (!key) return;

    if (handle) {
      this.storedRoutes.set(key, handle);
    } else {
      this.storedRoutes.delete(key);
    }
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const key = this.getRouteKey(route);
    return !!key && this.storedRoutes.has(key);
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = this.getRouteKey(route);
    if (!key || !this.storedRoutes.has(key)) return null;

    const handle = this.storedRoutes.get(key) || null;

    if (key === 'history' && this.uiService.historyScrollTop > 0) {
      const targetScroll = this.uiService.historyScrollTop;
      const restore = () => {
        const container = this.getScrollContainer();
        if (container) {
          container.scrollTop = targetScroll;
        }
      };

      requestAnimationFrame(() => {
        restore();
        setTimeout(restore, 20);
        setTimeout(restore, 80);
      });
    }

    return handle;
  }

  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }

  private getRouteKey(route: ActivatedRouteSnapshot): string | null {
    return route.routeConfig?.path ?? null;
  }
}
