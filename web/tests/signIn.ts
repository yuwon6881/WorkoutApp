import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const DASHBOARD = 'Let’s get stronger.';

/// Signs in through central Fitness Account via mock IdP.
export async function signIn(page: Page, username = 'e2e-lifter') {
  await page.goto('/');
  const dashboard = page.getByRole('heading', { name: DASHBOARD });
  const button = page.getByRole('button', { name: 'Sign in with Fitness Account', exact: true });

  // The app shows a loading state until the server says whether this session is signed in, so
  // wait for it to settle before deciding whether a sign-in is needed at all.
  await Promise.race([
    dashboard.waitFor({ state: 'visible', timeout: 30000 }),
    button.waitFor({ state: 'visible', timeout: 30000 })
  ]).catch(() => { /* the assertion below reports whatever state we ended in */ });

  if (await button.isVisible().catch(() => false)) {
    await button.click();

    const mockButton = page.getByRole('button', { name: 'Sign in to Fitness Account' });
    await mockButton.waitFor({ state: 'visible', timeout: 30000 });
    if (username) {
      await page.getByLabel('Username').fill(username);
    }
    await mockButton.click();
  }

  await expect(dashboard).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.profile strong')).toHaveText(username, { timeout: 30000 });
}
