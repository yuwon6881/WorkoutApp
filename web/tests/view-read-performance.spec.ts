import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

test.use({ serviceWorkers: 'block', actionTimeout: 10000 });

test('the library loading skeleton follows its responsive layout in both themes', async ({ page }, info) => {
  await signIn(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/exercises', async route => { await ready; await route.continue(); });
  try {
    await page.goto('/exercises', { waitUntil: 'domcontentloaded' });
    const skeleton = page.getByRole('status', { name: 'Loading Exercises', exact: true });
    await expect(skeleton).toBeVisible();
    await expect(skeleton.locator('.view-skeleton-exercise')).toHaveCount(6);
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth,
        viewport: Math.round(visualViewport?.width ?? innerWidth) }));
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1);
      await page.screenshot({ path: info.outputPath(`library-skeleton-${theme}.png`), fullPage: true });
    }
  } finally { release(); }
  await expect(page.getByRole('textbox', { name: 'Search exercises', exact: true })).toBeVisible();
});

test('library metadata and insight ranges survive a return visit in memory', async ({ page }, info) => {
  await signIn(page);
  // Replacing an older remembered launch correctly invalidates reads. Measure reuse only after
  // starting from the confirmed shell, rather than racing that independent startup transition.
  await page.evaluate(() => localStorage.removeItem('workout-launch-snapshot'));
  // Exercise reuse inside the freshness window even on a slow browser runner; expiry is covered
  // by viewReadCache.test.ts, and real timers keep driving the UI.
  await page.clock.setFixedTime(Date.now());
  const catalog = await (await page.request.get('/api/exercises')).json();
  const exercise = catalog[0];
  const baseline = await (await page.request.get(`/api/exercises/${exercise.id}/insight?range=3m&page=0&size=20`)).json();
  let metadataReads = 0;
  const rangeReads = new Map<string, number>();
  await page.route('**/api/exercises/last-performed', route => {
    metadataReads++;
    return route.fulfill({ json: [] });
  });
  await page.route(`**/api/exercises/${exercise.id}/insight?*`, route => {
    const range = new URL(route.request().url()).searchParams.get('range')!;
    rangeReads.set(range, (rangeReads.get(range) ?? 0) + 1);
    return route.fulfill({ json: { ...baseline, sessions: 2, totalHistoryRows: 2, setCount: 6 } });
  });
  await page.goto('/exercises');
  await expect.poll(() => metadataReads).toBe(1);
  await page.getByRole('textbox', { name: 'Search exercises', exact: true }).fill(exercise.name);
  await page.getByRole('button', { name: `View ${exercise.name} details`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: exercise.name, exact: true });
  await dialog.getByRole('button', { name: 'Progress range' }).click();
  await page.getByRole('option', { name: 'Last month', exact: true }).click();
  await expect.poll(() => rangeReads.get('1m')).toBe(1);
  await dialog.getByRole('button', { name: 'Progress range' }).click();
  await page.getByRole('option', { name: 'Last 3 months', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Progress range' })).toContainText('Last 3 months');
  expect(rangeReads.get('3m')).toBe(1);
  await dialog.screenshot({ path: info.outputPath('cached-insight.png') });
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exercises', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search exercises', exact: true })).toBeVisible();
  expect(metadataReads).toBe(1);
});
