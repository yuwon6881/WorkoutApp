import { test as setup } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { signIn } from './signIn';

setup('sign in for external import tests', async ({ page }) => {
  await signIn(page, 'e2e-external');
  mkdirSync('tests/.auth', { recursive: true });
  await page.context().storageState({ path: 'tests/.auth/external.json' });
});
