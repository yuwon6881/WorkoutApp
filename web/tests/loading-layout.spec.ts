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

/// The skeleton is swapped for its twin when the lazy chunk arrives, so a region clip is used rather
/// than an element screenshot, which would wait for a node that has just been replaced.
async function shoot(page: Page, selector: string, path: string) {
  const box = await page.locator(selector).boundingBox();
  if (box) await page.screenshot({ path, fullPage: true, clip: box });
}

/// Three finished workouts for the Overview's Recent workouts, so the loaded page has cards to compare with.
function historySummary(index: number) {
  const when = '2026-11-10T08:00:00.000Z';
  return {
    id: `skeleton-fit-${index}`, templateId: null, programId: null, name: `Skeleton fit ${index}`, note: '', active: false,
    startedAt: when, finishedAt: '2026-11-10T09:00:00.000Z', revision: 1, exercises: [], volumeKg: 2400,
    completedSets: 12, warmupSets: 0, prCount: 0, pausedSeconds: 0
  };
}

const historyPage = { total: 5, sessions: [0, 1, 2].map(historySummary), nextBeforeAt: null, nextBeforeId: null, summaryOnly: true };

test('recent workouts loading reserves the cards and heading the workouts then fill', async ({ page }, info) => {
  const measure = (section: string, card: string) => page.evaluate(([sectionSelector, cardSelector]) => {
    const cards = [...document.querySelectorAll(`${sectionSelector} ${cardSelector}`)].map(element => element.getBoundingClientRect());
    return {
      count: cards.length,
      width: Math.round(cards[0]?.width ?? 0),
      height: Math.round(cards[0]?.height ?? 0),
      // Inside the section, since what sits above it depends on the account's data.
      top: Math.round((cards[0]?.top ?? 0) - (document.querySelector(sectionSelector)?.getBoundingClientRect().top ?? 0)),
      columns: new Set(cards.map(rect => Math.round(rect.left))).size
    };
  }, [section, card] as const);

  await signIn(page);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/history/summaries?*', async route => {
      await ready;
      await route.fulfill({ json: historyPage });
    });
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      // The boot shell carries a copy of the skeleton too; measure the one the Overview itself draws.
      await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
      await expect(page.locator('.recent-skeleton')).toBeVisible();
      const loading = await measure('.recent-skeleton', '.recent-skeleton-card');
      await shoot(page, '.recent-skeleton', info.outputPath(`recent-loading-${width}.png`));
      release();
      await expect(page.getByRole('region', { name: 'Recent workouts' }).locator('.history-row')).toHaveCount(3);
      const loaded = await measure('.history-recent', '.history-item-wrap');
      await shoot(page, '.history-recent', info.outputPath(`recent-loaded-${width}.png`));

      expect(loading.count, `${width}px cards`).toBe(loaded.count);
      expect(loading.columns, `${width}px columns`).toBe(loaded.columns);
      expect(Math.abs(loading.width - loaded.width), `${width}px card width`).toBeLessThanOrEqual(2);
      // Whether a card's figures wrap onto a second line depends on the figures and on a fraction of a
      // pixel at the medium widths, which a placeholder cannot know: one line of difference is allowed
      // there, while a phone must match exactly.
      expect(Math.abs(loading.height - loaded.height), `${width}px card height`).toBeLessThanOrEqual(width < 640 ? 6 : 28);
      expect(Math.abs(loading.top - loaded.top), `${width}px first card offset in its section`).toBeLessThanOrEqual(4);
    } finally {
      release();
      await page.unroute('**/api/history/summaries?*');
    }
  }
});

/// What the Overview's placeholders can honestly match: where the grid starts under the heading, how tall the
/// calendar card is, and the Recent workouts' own shape. The next-workout card's height follows the account's
/// program and plan, which no placeholder can know, so it is not compared.
async function overviewGeometry(page: Page, calendar: string) {
  return page.evaluate(selector => {
    const box = (query: string) => document.querySelector(query)?.getBoundingClientRect();
    return { gridTop: Math.round((box('.overview-hero-calendar-grid')?.top ?? 0) + scrollY), calendarHeight: Math.round(box(selector)?.height ?? 0) };
  }, calendar);
}

test('the Overview placeholders sit where the loaded page does, so nothing jumps as a load proceeds', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/history/summaries?*', route => route.fulfill({ json: historyPage }));
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Recent workouts' }).locator('.history-row').first()).toBeVisible();
    const loaded = await overviewGeometry(page, '.training-calendar-card');

    // The boot shell: the page's own HTML, painted before the app's code has run. Blocking the app
    // bundle leaves exactly that frame on screen.
    const appBundle = /\/assets\/index-[^/]+\.js$/;
    await page.route(appBundle, route => route.abort());
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.app-loading-shell .recent-skeleton')).toBeVisible();
      const shell = await overviewGeometry(page, '.training-calendar-card');
      expect(Math.abs(shell.gridTop - loaded.gridTop), `${width}px boot grid top`).toBeLessThanOrEqual(3);
      // Stacked, the calendar is its own height; side by side it stretches to the next-workout card.
      if (width < 1024) expect(Math.abs(shell.calendarHeight - loaded.calendarHeight), `${width}px boot calendar height`).toBeLessThanOrEqual(6);
    } finally { await page.unroute(appBundle); }

    // The view's own placeholder, drawn while the lazy Overview code arrives, is the same frame.
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/assets\/Dashboard-[^/]+\.js$/, async route => { await ready; await route.continue(); });
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.view-skeleton-overview .recent-skeleton')).toBeVisible();
      const view = await overviewGeometry(page, '.training-calendar-card');
      expect(Math.abs(view.gridTop - loaded.gridTop), `${width}px placeholder grid top`).toBeLessThanOrEqual(3);
      if (width < 1024) expect(Math.abs(view.calendarHeight - loaded.calendarHeight), `${width}px placeholder calendar height`).toBeLessThanOrEqual(6);
    } finally {
      release();
      await page.unroute(/\/assets\/Dashboard-[^/]+\.js$/);
    }
  }
});
