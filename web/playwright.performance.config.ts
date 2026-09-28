import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import base from './playwright.config';

export default defineConfig({
  ...base,
  preserveOutput: 'always',
  use: { ...base.use, reducedMotion: 'no-preference', trace: 'on' },
  projects: [
    { name: 'setup', testMatch: 'auth.setup.ts' },
    { name: 'mobile-motion', testMatch: ['touch.spec.ts', 'app.spec.ts'], dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: join(process.env.WORKOUT_TEST_AUTH_DIRECTORY || 'tests/.auth', 'lifter.json') } },
    { name: 'mobile-performance', testMatch: 'performance.spec.ts', dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: join(process.env.WORKOUT_TEST_AUTH_DIRECTORY || 'tests/.auth', 'lifter.json') } }
  ]
});
