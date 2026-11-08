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

// A tab may remain open across a deployment. Its worker must retain the import view and
// the text helper even after the server has removed that version's hashed files.
test('the installed shell retains the import view and its text helper', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const requests = await Promise.all(keys.map(async key => (await caches.open(key)).keys()));
    return requests.flat().map(request => new URL(request.url).pathname);
  });
  expect(cached.some(path => /\/assets\/Import-[^/]+\.js$/.test(path))).toBe(true);
  expect(cached.some(path => /\/assets\/pdfText-[^/]+\.js$/.test(path))).toBe(true);
  expect(cached.some(path => /\/assets\/pdf-[^/]+\.js$/.test(path))).toBe(false);
});
