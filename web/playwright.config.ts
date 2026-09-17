import { defineConfig, devices } from '@playwright/test';
import { testServers } from './tests/servers';

const signedIn = { storageState: 'tests/.auth/lifter.json' };

export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1, timeout: 120000,
  use: { baseURL: process.env.WORKOUT_BASE_URL || 'http://localhost:5182', headless: true, channel: 'chrome', reducedMotion: 'reduce' },
  projects: [
    { name: 'setup', testMatch: 'auth.setup.ts' },
    { name: 'desktop', testMatch: 'app.spec.ts', dependencies: ['setup'], use: { ...devices['Desktop Chrome'], ...signedIn, viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', testMatch: 'app.spec.ts', dependencies: ['setup'], use: { ...devices['iPhone 13'], ...signedIn, defaultBrowserType: 'chromium' } },
    { name: 'tablet', testMatch: 'app.spec.ts', dependencies: ['setup'], use: { ...devices['Desktop Chrome'], ...signedIn, viewport: { width: 768, height: 1024 } } }
  ],
  webServer: process.env.WORKOUT_BASE_URL ? undefined : testServers,
  reporter: 'list'
});
