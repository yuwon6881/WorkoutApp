import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { signIn } from './signIn';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

async function checkSkeleton(page: Page, info: TestInfo, view: 'exercises' | 'body') {
  const skeleton = page.locator(`.view-skeleton.view-skeleton-${view}`);
  await expect(skeleton).toBeVisible();
  for (const width of [320, 390, 640, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const geometry = await skeleton.evaluate((element, view) => ({
        width: document.documentElement.scrollWidth,
        viewport: Math.round(visualViewport?.width ?? innerWidth),
        columns: getComputedStyle(element.querySelector(view === 'body' ? '.view-skeleton-muscle-grid' : '.view-skeleton-cards')!)
          .gridTemplateColumns.split(' ').length
      }), view);
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.columns).toBe(view === 'body' ? width < 1024 ? 1 : 2 : width < 640 ? 1 : width <= 1190 ? 2 : 3);
      await page.screenshot({ path: info.outputPath(`${view}-${width}-${theme}.png`), fullPage: true });
    }
  }
}

test('exercise loading follows the real library column breakpoints', async ({ page }, info) => {
  await signIn(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/exercises', async route => { await ready; await route.continue(); });
  try {
    await page.goto('/exercises', { waitUntil: 'domcontentloaded' });
    await checkSkeleton(page, info, 'exercises');
  } finally { release(); }
  await expect(page.getByRole('textbox', { name: 'Search exercises', exact: true })).toBeVisible();
});

test('muscle loading stacks on medium windows and never widens the page', async ({ page }, info) => {
  await signIn(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/assets\/MuscleBalanceView-[^/]+\.js$/, async route => { await ready; await route.continue(); });
  try {
    await page.goto('/muscles', { waitUntil: 'domcontentloaded' });
    await checkSkeleton(page, info, 'body');
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Muscle coverage', exact: true })).toBeVisible();
});
