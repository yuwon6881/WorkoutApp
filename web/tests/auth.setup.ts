import { test as setup } from '@playwright/test';
import { signIn } from './signIn';

// Sign-in is rate limited per address, as it should be. Doing it once and reusing the session
// keeps the suite well under that limit instead of weakening the protection for tests.
setup('sign in once and save the session', async ({ page }) => {
  await signIn(page, 'e2e-lifter');
  await page.context().storageState({ path: 'tests/.auth/lifter.json' });
});

setup('sign in once for the responsive suite', async ({ page }) => {
  await signIn(page, 'e2e-responsive');
  await page.context().storageState({ path: 'tests/.auth/responsive.json' });
});
