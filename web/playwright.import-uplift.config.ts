import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { testServers } from './tests/servers';

export default defineConfig({
  testDir: './tests', workers: 1, timeout: 120000,
  outputDir: process.env.WORKOUT_TEST_RESULTS_DIRECTORY || 'test-results/import-uplift',
  use: { baseURL: `http://localhost:${process.env.WORKOUT_TEST_WEB_PORT || '5682'}`, channel: 'chrome',
    serviceWorkers: 'block', reducedMotion: 'reduce' },
  projects: [
    { name: 'setup', testMatch: 'auth.setup.ts' },
    ...[320, 390, 640, 768, 1024, 1440, 1920].map(width => ({ name: `${width}px`, testMatch: 'import-uplift.spec.ts', dependencies: ['setup'],
      use: { storageState: join(process.env.WORKOUT_TEST_AUTH_DIRECTORY || 'tests/.auth', 'responsive.json'), viewport: { width, height: 1000 } } }))
  ],
  webServer: testServers, reporter: 'list'
});
