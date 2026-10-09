import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { testServers } from './tests/servers';

const authDirectory = process.env.WORKOUT_TEST_AUTH_DIRECTORY || 'tests/.auth';
const webPort = process.env.WORKOUT_TEST_WEB_PORT || '5182';

export default defineConfig({
  testDir: './tests', workers: 1, timeout: 180000,
  outputDir: process.env.WORKOUT_TEST_RESULTS_DIRECTORY || 'test-results',
  // The app registers its PWA worker after load and claims the page, and page.route() cannot
  // intercept requests a service worker sees, so a fixture route could lose the race mid-test.
  // Nothing in this suite exercises the worker; app-update.spec.ts covers it in the main config.
  use: { baseURL: process.env.WORKOUT_BASE_URL || `http://localhost:${webPort}`, channel: 'chrome', headless: true, serviceWorkers: 'block' },
  projects: [
    { name: 'setup', testMatch: 'auth.setup.ts' },
    ...[320, 390, 640, 768, 1024, 1440, 1920].map(width => ({
      name: `${width}px`, testMatch: 'responsive.spec.ts', dependencies: ['setup'],
      use: { storageState: join(authDirectory, 'responsive.json'), viewport: { width, height: width < 640 ? 844 : 1000 }, isMobile: width < 640, hasTouch: width < 1024 }
    }))
  ],
  webServer: process.env.WORKOUT_BASE_URL ? undefined : testServers,
  reporter: 'list'
});
