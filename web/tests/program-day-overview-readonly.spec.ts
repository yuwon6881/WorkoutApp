import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

test.use({ serviceWorkers: 'block' });

test('a pending program day opens as a read-only overview before Start', async ({ page }) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const active = await (await page.request.get('/api/workouts/active')).json();
  if (active) await page.request.post(`/api/workouts/${active.id}/discard`, { headers });
  const catalog = await (await page.request.get('/api/exercises')).json();
  const bench = catalog.find((exercise: { name: string }) => exercise.name === 'Barbell bench press') ?? catalog[0];
  const plannedExercises = [
    { exerciseId: bench.id, sourceName: bench.name },
    { exerciseId: null, sourceName: 'Leg curl' }
  ];
  const name = `Retry audit ${Date.now()}`;
  const created = await page.request.post('/api/programs', { headers, data: {
    name, workouts: [{ week: 1, name: 'Original day', exercises: plannedExercises.map(exercise => ({
      exerciseId: exercise.exerciseId, sourceName: exercise.sourceName,
      sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 60, warmup: false }]
    })) }]
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const program = await created.json();
  const activated = await page.request.post(`/api/programs/${program.id}/active`, { headers, data: { active: true, revision: program.revision } });
  expect(activated.ok(), await activated.text()).toBeTruthy();
  let previewRequests = 0;
  await page.route(`**/api/templates/${program.workouts[0].id}/start-preview`, route => {
    previewRequests++;
    return route.fulfill({ json: program.workouts[0].exercises.map((exercise: { id: string }, index: number) => ({
      templateExerciseId: exercise.id,
      sets: [{ position: 0, warmup: false, weightKg: index === 0 ? 72.5 + (previewRequests - 1) * 2.5 : 50, resistanceMode: 'external' }]
    })) });
  });
  try {
    await page.goto('/workouts');
    const card = page.locator('.program-card').filter({ hasText: name });
    await card.getByRole('button', { name: 'View Original day', exact: true }).click();
    const dialog = page.locator('.day-detail-modal');
    // The overview before Start only shows the plan; programs are edited from their own menu.
    await expect(dialog.getByRole('button', { name: 'Start workout', exact: true })).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(dialog.getByRole('spinbutton')).toHaveCount(0);
    await expect.poll(() => previewRequests).toBe(1);
    await expect(dialog.locator('.readonly-set-load').first()).toHaveText('at 72.5 kg');
    const hamstringsLabel = dialog.locator('.program-muscle-tile strong', { hasText: 'Hamstrings' });
    await expect(hamstringsLabel).toBeVisible();
    const muscleLabelsStayOnOneLine = await hamstringsLabel.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects().length === 1;
    });
    expect(muscleLabelsStayOnOneLine).toBe(true);
    const tileWidthsMatch = await dialog.locator('.program-muscle-grid > li').evaluateAll(items => {
      const widths = items.map(item => item.getBoundingClientRect().width);
      return widths.every(width => Math.abs(width - widths[0]) < 1);
    });
    expect(tileWidthsMatch).toBe(true);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await card.getByRole('button', { name: 'View Original day', exact: true }).click();
    await expect(page.locator('.day-detail-modal .readonly-set-load').first()).toHaveText('at 75 kg');
    expect(previewRequests).toBe(2);
  } finally {
    await page.request.delete(`/api/programs/${program.id}`, { headers });
  }
});
