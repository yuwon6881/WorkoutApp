import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import { testServers } from './tests/servers';

const authDirectory = process.env.WORKOUT_TEST_AUTH_DIRECTORY || 'tests/.auth';
const webPort = process.env.WORKOUT_TEST_WEB_PORT || '5182';

export default defineConfig({
  testDir: './tests', fullyParallel: false, workers: 1, timeout: 120000,
  outputDir: process.env.WORKOUT_TEST_RESULTS_DIRECTORY || 'test-results',
  use: { baseURL: process.env.WORKOUT_BASE_URL || `http://localhost:${webPort}`, headless: true, channel: 'chrome', reducedMotion: 'reduce' },
  projects: [
    { name: 'setup', testMatch: 'auth.setup.ts' },
    { name: 'desktop', testMatch: 'app.spec.ts', dependencies: ['setup'], use: { ...devices['Desktop Chrome'], storageState: join(authDirectory, 'lifter.json'), viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', testMatch: 'app.spec.ts', dependencies: ['setup'], use: { ...devices['iPhone 13'], storageState: join(authDirectory, 'lifter.json'), defaultBrowserType: 'chromium' } },
    { name: 'tablet', testMatch: 'app.spec.ts', dependencies: ['setup'], use: { ...devices['Desktop Chrome'], storageState: join(authDirectory, 'lifter.json'), viewport: { width: 768, height: 1024 } } },
    // Real touch input on an Android phone profile: gestures, sheets, and keyboard behaviour.
    // Pixel baselines at a phone and a desktop size.
    { name: 'baseline-phone', testMatch: 'baseline.spec.ts', use: { ...devices['Pixel 7'] } },
    { name: 'baseline-desktop', testMatch: 'baseline.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'touch', testMatch: 'touch.spec.ts', dependencies: ['setup'], use: { ...devices['Pixel 7'], storageState: join(authDirectory, 'lifter.json') } }
  ],
  webServer: process.env.WORKOUT_BASE_URL ? undefined : testServers,
  reporter: 'list'
});
