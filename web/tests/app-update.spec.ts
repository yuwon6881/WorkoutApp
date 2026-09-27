import { expect, test } from '@playwright/test';

test('Reload activates the waiting update and navigates the current tab', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await navigator.serviceWorker.register(`/sw.js?update-test=${Date.now()}`, { scope: '/' });
  });
  const reload = page.getByRole('button', { name: 'Reload', exact: true });
  await expect(reload).toBeVisible();
  await Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame()), reload.click()]);
  await expect(reload).toBeHidden();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
});
