import {expect, test} from '@playwright/test';

test('signed-out Workout login follows the saved theme on phone, tablet, and desktop', async ({page}) => {
  for (const width of [390, 768, 1440]) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({width, height: 900});
      await page.emulateMedia({colorScheme: theme === 'light' ? 'dark' : 'light'});
      await page.addInitScript(selected => {
        localStorage.setItem('workout-theme', selected);
        document.documentElement.dataset.theme = selected;
      }, theme);
      await page.goto('/');
      await expect(page.getByRole('heading', {name: 'Welcome'})).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('button', {name: 'Sign in with Fitness Account'})).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({path: test.info().outputPath(`workout-login-${width}-${theme}.png`), fullPage: true, animations: 'disabled'});
    }
  }
});

test('Workout forwards the saved theme when opening Fitness Account', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('workout-theme', 'light'));
  let requestedUrl = '';
  await page.route('**/api/auth/central/start*', async route => {
    requestedUrl = route.request().url();
    await route.fulfill({status: 200, contentType: 'text/html', body: '<main>Fitness Account preview</main>'});
  });
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Welcome'})).toBeVisible();
  await page.getByRole('button', {name: 'Sign in with Fitness Account'}).click();
  await expect(page.getByText('Fitness Account preview')).toBeVisible();
  expect(new URL(requestedUrl).searchParams.get('theme')).toBe('light');
});
