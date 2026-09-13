import { defineConfig } from '@playwright/test';
import { testServers } from './tests/servers';

export default defineConfig({
  testDir: './tests', workers: 1, timeout: 180000,
  use: { baseURL: process.env.WORKOUT_BASE_URL || 'http://localhost:5182', channel: 'chrome', headless: true },
  projects: [
    { name: 'setup', testMatch: 'auth.setup.ts' },
    ...[320, 390, 640, 768, 1024, 1440, 1920].map(width => ({
      name: `${width}px`, testMatch: 'responsive.spec.ts', dependencies: ['setup'],
      use: { storageState: 'tests/.auth/responsive.json', viewport: { width, height: width < 640 ? 844 : 1000 }, isMobile: width < 640, hasTouch: width < 1024 }
    }))
  ],
  webServer: process.env.WORKOUT_BASE_URL ? undefined : testServers,
  reporter: 'list'
});
