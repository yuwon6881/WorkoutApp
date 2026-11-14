import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

test('a pending program day opens as a read-only overview before Start', async ({ page }) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const active = await (await page.request.get('/api/workouts/active')).json();
  if (active) await page.request.post(`/api/workouts/${active.id}/discard`, { headers });
  const catalog = await (await page.request.get('/api/exercises')).json();
  const name = `Retry audit ${Date.now()}`;
  const created = await page.request.post('/api/programs', { headers, data: {
    name, workouts: [{ week: 1, name: 'Original day', exercises: [{
      exerciseId: catalog[0].id, sourceName: catalog[0].name,
      sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 60, warmup: false }]
    }] }]
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const program = await created.json();
  const activated = await page.request.post(`/api/programs/${program.id}/active`, { headers, data: { active: true, revision: program.revision } });
  expect(activated.ok(), await activated.text()).toBeTruthy();
  try {
    await page.goto('/workouts');
    const card = page.locator('.program-card').filter({ hasText: name });
    await card.getByRole('button', { name: 'View Original day', exact: true }).click();
    const dialog = page.locator('.day-detail-modal');
    // The overview before Start only shows the plan; programs are edited from their own menu.
    await expect(dialog.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(dialog.getByRole('spinbutton')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/programs/${program.id}`, { headers });
  }
});
