import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

test('failed program day edits stay visible and retry against the saved revision', async ({ page }) => {
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
  let fail = true;
  const route = `**/api/templates/${program.workouts[0].id}`;
  await page.route(route, async request => {
    if (request.request().method() === 'PUT' && fail) {
      await request.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Audit save unavailable' }) });
    } else await request.continue();
  });
  try {
    await page.goto('/workouts');
    const card = page.locator('.program-card').filter({ hasText: name });
    await card.getByRole('button', { name: 'View Original day', exact: true }).click();
    const dialog = page.locator('.day-detail-modal');
    await dialog.getByRole('textbox', { name: 'Day name', exact: true }).fill('Retained day');
    await dialog.getByRole('textbox', { name: 'Day name', exact: true }).blur();
    await expect(dialog.getByRole('alert')).toContainText('Audit save unavailable');
    await expect(dialog.getByRole('textbox', { name: 'Day name', exact: true })).toHaveValue('Retained day');
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByRole('alert')).toContainText('Audit save unavailable');
    fail = false;
    await card.getByRole('button', { name: 'Retry save', exact: true }).click();
    await expect.poll(async () => {
      const saved = await (await page.request.get(`/api/programs/${program.id}`)).json();
      return saved.workouts[0].name;
    }).toBe('Retained day');
    await expect(card.getByRole('alert')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'View Retained day', exact: true })).toBeVisible();
  } finally {
    await page.unroute(route);
    await page.request.delete(`/api/programs/${program.id}`, { headers });
  }
});
