import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { signIn } from './signIn';

const USER = 'e2e-lifter';
const screenshotsDirectory = process.env.WORKOUT_TEST_SCREENSHOTS || 'artifacts';

async function chooseRest(day: ReturnType<Page['locator']>, page: Page, exercise: string, rest: string) {
  await day.getByRole('button', { name: `Rest timer for ${exercise}`, exact: true }).click();
  await page.getByRole('option', { name: rest, exact: true }).click();
}

test('several exercises edited on one day are saved together with one question about where they reach', async ({ page }, info) => {
  await signIn(page, USER);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const programName = `Batch save ${info.project.name} ${Date.now()}`;
  let programId: string | null = null;
  try {
    const catalog = await (await page.request.get('/api/exercises')).json() as { id: string; name: string }[];
    const bench = catalog.find(item => item.name === 'Barbell bench press') ?? catalog[0];
    const row = catalog.find(item => item.name !== bench.name && item.name.toLowerCase().includes('row')) ?? catalog[1];
    const exercises = [bench, row].map(item => ({
      exerciseId: item.id, sourceName: item.name, sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90 }]
    }));
    const created = await page.request.post('/api/programs', { headers, data: { name: programName, workouts: [
      { week: 1, name: 'Push A', exercises }, { week: 2, name: 'Push B', exercises }
    ] } });
    expect(created.ok(), await created.text()).toBeTruthy();
    programId = (await created.json()).id;

    await page.goto('/workouts');
    // A new program takes the active slot when it is empty and waits in the library otherwise.
    const card = page.locator('.program-card, .library-program-card').filter({ hasText: programName });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: `Actions for ${programName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit program', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit program', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Push A', exact: true }).click();
    const day = page.locator('.day-detail-modal');
    await expect(day).toBeVisible();
    // One edited exercise has its own Save; the combined one waits for a second.
    await chooseRest(day, page, bench.name, '3m');
    await expect(day.getByRole('button', { name: /^Save \d+ changes$/ })).toHaveCount(0);
    await chooseRest(day, page, row.name, '2m');
    const saveAll = day.getByRole('button', { name: 'Save 2 changes', exact: true });
    await expect(saveAll).toBeVisible();

    await saveAll.click();
    const review = page.getByRole('dialog', { name: 'Save changes to 2 exercises', exact: true });
    await expect(review).toBeVisible();
    await expect(review.getByText('rest timer', { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: join(screenshotsDirectory, `${info.project.name}-batch-review.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
    await review.getByRole('button', { name: 'Save 2 exercises', exact: true }).click();
    await expect(review).toBeHidden({ timeout: 30000 });

    // Nothing is left unsaved on the day, so closing it does not ask about discarding.
    await expect(day.locator('[data-import-save-bar]')).toHaveCount(0);
    // A phone's sheet drops a footer that holds only Done, so the header's close is used everywhere.
    await day.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true })).toHaveCount(0);
    await expect(day).toBeHidden();

    // The default reach is the same block, so the other week followed.
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
    const saved = await (await page.request.get(`/api/programs/${programId}`)).json();
    for (const dayName of ['Push A', 'Push B']) {
      const rests = saved.workouts.find((item: { name: string }) => item.name === dayName).exercises
        .map((item: { sourceName: string; restSeconds: number }) => [item.sourceName, item.restSeconds]);
      expect(rests).toEqual([[bench.name, 180], [row.name, 120]]);
    }
  } finally {
    if (programId) await page.request.delete(`/api/programs/${programId}`, { headers }).catch(() => {});
  }
});
