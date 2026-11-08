import { defineConfig } from '@playwright/test';
import { testServers } from './tests/servers';

if (process.env.WORKOUT_BASE_URL || process.env.WORKOUT_TEST_DATABASE)
  throw new Error('External import browser tests require their own disposable servers and database.');

export default defineConfig({
  testDir: './tests', workers: 1, timeout: 180000,
  outputDir: process.env.WORKOUT_TEST_RESULTS_DIRECTORY || 'test-results/external-c3',
  use: { baseURL: `http://localhost:${process.env.WORKOUT_TEST_WEB_PORT || '5182'}`, channel: 'chrome',
    headless: true, serviceWorkers: 'block', reducedMotion: 'reduce' },
  projects: [
    { name: 'setup', testMatch: 'external-auth.setup.ts' },
    ...[390, 768, 1440].map(width => ({ name: `${width}px`, testMatch: 'external-import.spec.ts', dependencies: ['setup'],
      use: { storageState: 'tests/.auth/external.json', viewport: { width, height: 900 },
        isMobile: width < 640, hasTouch: width < 1024 } }))
  ],
  webServer: testServers.map(server => ({ ...server, reuseExistingServer: false,
    ...(server.env ? { env: { ...server.env, RateLimits__ExternalImportWindowSeconds: '1' } } : {}) })),
  reporter: 'list'
});
