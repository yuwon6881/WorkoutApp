import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { signIn } from './signIn';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

type SkeletonView = 'exercises' | 'body' | 'program' | 'import' | 'settings';

const SCREENSHOT_WIDTHS = new Set([320, 768, 1024, 1440]);

async function checkSkeleton(page: Page, info: TestInfo, view: SkeletonView) {
  const skeleton = page.locator(`.view-skeleton.view-skeleton-${view}`);
  await expect(skeleton).toBeVisible();
  for (const width of [320, 390, 640, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const geometry = await skeleton.evaluate((element, current) => {
        const cards = element.querySelector('.view-skeleton-cards');
        const grid = element.querySelector('.view-skeleton-muscle-grid');
        const settingsShell = element.querySelector('.view-skeleton-settings-shell');
        const settingsNav = element.querySelector('.view-skeleton-settings-nav');
        return {
          width: document.documentElement.scrollWidth,
          viewport: Math.round(visualViewport?.width ?? innerWidth),
          cardsColumns: cards ? getComputedStyle(cards).gridTemplateColumns.split(' ').length : 0,
          muscleColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
          settingsColumns: settingsShell ? getComputedStyle(settingsShell).gridTemplateColumns.split(' ').length : 0,
          settingsNavDisplay: settingsNav ? getComputedStyle(settingsNav).display : '',
          uploadCount: element.querySelectorAll('.view-skeleton-upload, .view-skeleton-external').length,
          slotCount: element.querySelectorAll('.view-skeleton-slot, .view-skeleton-library-card').length,
          view: current
        };
      }, view);
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1);
      if (view === 'exercises') expect(geometry.cardsColumns).toBe(width < 640 ? 1 : width <= 1190 ? 2 : 3);
      if (view === 'body') expect(geometry.muscleColumns).toBe(width < 1024 ? 1 : 2);
      if (view === 'program') { expect(geometry.cardsColumns).toBe(1); expect(geometry.slotCount).toBe(4); }
      if (view === 'import') expect(geometry.uploadCount).toBe(2);
      if (view === 'settings') {
        expect(geometry.settingsColumns).toBe(width < 1024 ? 1 : 2);
        expect(geometry.settingsNavDisplay).toBe(width < 1024 ? 'flex' : 'grid');
      }
      if (SCREENSHOT_WIDTHS.has(width)) {
        await page.screenshot({ path: info.outputPath(`${view}-${width}-${theme}.png`), fullPage: true });
      }
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

test('programs loading matches active slot and library card layout', async ({ page }, info) => {
  await signIn(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/assets\/Programs-[^/]+\.js$/, async route => { await ready; await route.continue(); });
  try {
    await page.goto('/workouts', { waitUntil: 'domcontentloaded' });
    await checkSkeleton(page, info, 'program');
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
});

test('import loading renders stacked source panels without overflow', async ({ page }, info) => {
  await signIn(page);
  const active = await (await page.request.get('/api/workouts/active')).json();
  if (active) await page.request.post(`/api/workouts/${active.id}/discard`, { headers: { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin } });
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/assets\/Import-[^/]+\.js$/, async route => { await ready; await route.continue(); });
  try {
    await page.goto('/import', { waitUntil: 'domcontentloaded' });
    await checkSkeleton(page, info, 'import');
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Import a program', exact: true })).toBeVisible();
});

test('settings loading mirrors account card, section nav, and panels across breakpoints', async ({ page }, info) => {
  await signIn(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/assets\/Settings-[^/]+\.js$/, async route => { await ready; await route.continue(); });
  try {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await checkSkeleton(page, info, 'settings');
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});
