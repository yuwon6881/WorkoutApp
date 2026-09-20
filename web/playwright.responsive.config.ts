import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { testServers } from './tests/servers';

const authDirectory = process.env.WORKOUT_TEST_AUTH_DIRECTORY || 'tests/.auth';
const webPort = process.env.WORKOUT_TEST_WEB_PORT || '5182';

export default defineConfig({
  testDir: './tests', workers: 1, timeout: 180000,
  outputDir: process.env.WORKOUT_TEST_RESULTS_DIRECTORY || 'test-results',
  use: { baseURL: process.env.WORKOUT_BASE_URL || `http://localhost:${webPort}`, channel: 'chrome', headless: true },
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
