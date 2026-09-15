import { defineConfig } from 'vitest/config';

/**
 * Give every spec file its own module registry.
 *
 * Angular's unit-test builder defaults to `isolate: false`, which makes all spec files in
 * a worker share one module graph. A spec that mocks a package with `vi.mock` then only
 * gets its mock if it happens to be the first file in that worker to load the package,
 * so the suite's outcome depends on the order Vitest picks -- which follows bundle sizes
 * and therefore changes whenever the app grows. Isolating costs a second or two and makes
 * the result depend on the tests instead.
 */
export default defineConfig({
  test: {
    isolate: true,
  },
});
