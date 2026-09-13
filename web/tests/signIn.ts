import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const DASHBOARD = 'Let’s get stronger.';

/// Signs in through the real form. The first run of a fresh database has no account, so a
/// failed sign-in falls through to registration rather than guessing which state we are in.
export async function signIn(page: Page, username: string, password: string) {
  await page.goto('/');
  const dashboard = page.getByRole('heading', { name: DASHBOARD });
  const button = page.getByRole('button', { name: 'Sign in', exact: true });

  // The app shows a loading state until the server says whether this session is signed in, so
  // wait for it to settle before deciding whether a sign-in is needed at all.
  await Promise.race([
    dashboard.waitFor({ state: 'visible', timeout: 30000 }),
    button.waitFor({ state: 'visible', timeout: 30000 })
  ]).catch(() => { /* the assertion below reports whatever state we ended in */ });

  if (await button.isVisible().catch(() => false)) {
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await button.click();
    // Wait for the request to resolve one way or the other before deciding what to do next.
    await Promise.race([
      dashboard.waitFor({ state: 'visible', timeout: 20000 }),
      page.getByRole('alert').waitFor({ state: 'visible', timeout: 20000 })
    ]).catch(() => { /* the assertion below reports whatever state we ended in */ });

    if (await page.getByRole('alert').isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Create an account instead' }).click();
      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
    }
  }

  await expect(dashboard).toBeVisible({ timeout: 30000 });
}
