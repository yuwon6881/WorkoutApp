import { test as setup } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { signIn } from './signIn';

const authDirectory = process.env.WORKOUT_TEST_AUTH_DIRECTORY || 'tests/.auth';
mkdirSync(authDirectory, { recursive: true });

// Sign-in is rate limited per address, as it should be. Doing it once and reusing the session
// keeps the suite well under that limit instead of weakening the protection for tests.
setup('sign in once and save the session', async ({ page }) => {
  await signIn(page, 'e2e-lifter');
  await page.context().storageState({ path: join(authDirectory, 'lifter.json') });
});

setup('sign in once for the responsive suite', async ({ page }) => {
  await signIn(page, 'e2e-responsive');
  await page.context().storageState({ path: join(authDirectory, 'responsive.json') });
});
