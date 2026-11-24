import { expect, test, type Page } from '@playwright/test';
import { signIn } from './signIn';
import type { Session } from '../src/types';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

test('weighted bodyweight live records use the edited load offline', async ({ page, context }, info) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  if (bootstrap.activeWorkout?.active)
    await page.request.post(`/api/workouts/${bootstrap.activeWorkout.id}/discard`, { headers });
  const custom = await page.request.post('/api/exercises/custom', { headers, data: {
    name: `Weighted Pull-Up ${info.project.name} ${Date.now()}`, muscle: 'Back',
    equipment: 'Bodyweight', loadModel: 'full_bodyweight'
  } });
  expect(custom.ok(), await custom.text()).toBeTruthy();
  const exercise = await custom.json();
  let templateId: string | undefined;
  let sessionId: string | undefined;
  try {
    const created = await page.request.post('/api/templates', { headers, data: {
      name: 'Frozen bodyweight live record', exercises: [{ exerciseId: exercise.id, sourceName: exercise.name,
        sets: [{ repMin: 5, repMax: 8, targetRpe: 8, restSeconds: 0 }] }]
    } });
    expect(created.ok(), await created.text()).toBeTruthy();
    templateId = (await created.json()).id;
    const started = await page.request.post('/api/workouts', { headers, data: { templateId } });
    expect(started.ok(), await started.text()).toBeTruthy();
    const session: Session = await started.json();
    sessionId = session.id;
    // Fixture replaces the unavailable Nutrition provider and completed-history baseline only.
    session.bodyWeight = { referenceKg: 80, referenceSource: 'scale', referenceDate: '2026-10-15',
      scaleWeightKg: 80, scaleDate: '2026-10-15', trendWeightKg: null, trendDate: null,
      calculationVersion: 'v1', nutritionRevision: 1, capturedAt: session.startedAt };
    session.exercises[0].previousBestE1rmKg = 105;
    session.exercises[0].previousRepRecords = [
      { loadModel: 'full_bodyweight', resistanceMode: 'added', loadKg: 90, reps: 4 }
    ];
    Object.assign(session.exercises[0].sets[0], { weightKg: 5, systemLoadKg: 85, reps: 5, rpe: 8 });
    await page.request.put('/api/preferences', { headers, data: { ...bootstrap.preferences, unit: 'kg' } });
    await page.route('**/api/bootstrap/**', async route => {
      const response = await route.fetch();
      const json = await response.json();
      json.activeWorkout = session;
      await route.fulfill({ response, json });
    });
    await page.route('**/api/workouts/active', route => route.fulfill({ json: session }));
    await page.route(`**/api/workouts/${session.id}`, route => route.fulfill({ json: session }));
    await page.goto('/');
    const workout = page.getByRole('dialog', { name: session.name, exact: true });
    await expect(workout).toBeVisible();
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    const load = workout.getByRole('spinbutton', { name: `${exercise.name} set 1 added weight`, exact: true });
    await load.fill('10');
    await load.blur();
    await workout.getByRole('button', { name: `Log ${exercise.name} set 1`, exact: true }).click();
    await expect(workout.getByRole('status').filter({ hasText: 'New strength and rep best' })).toContainText('111 kg');
    await expect(workout.getByRole('status').filter({ hasText: 'New strength and rep best' })).toContainText('5 reps at 90 kg');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally {
    await context.setOffline(false);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    if (sessionId) await page.request.post(`/api/workouts/${sessionId}/discard`, { headers });
    if (templateId) await page.request.delete(`/api/templates/${templateId}`, { headers });
    await page.request.delete(`/api/exercises/custom/${exercise.id}`, { headers });
    await page.request.put('/api/preferences', { headers, data: bootstrap.preferences });
  }
});

async function checkGeometry(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const heading = page.locator('.col-load').filter({ visible: true });
  expect(await heading.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

test('weight basis persists from custom creation through workout entry and unit changes', async ({ page }, info) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const original = await (await page.request.get('/api/bootstrap')).json();
  if (original.activeWorkout?.active)
    await page.request.post(`/api/workouts/${original.activeWorkout.id}/discard`, { headers });
  const name = `Side press ${info.project.name} ${Date.now()}`;
  let sideId: string | null = null;
  let totalId: string | null = null;
  let templateId: string | null = null;
  let sessionId: string | null = null;
  try {
    await page.goto('/exercises');
    await page.getByRole('button', { name: 'Create exercise', exact: true }).click();
    const custom = page.getByRole('dialog', { name: 'Create custom exercise', exact: true });
    await custom.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await custom.getByRole('button', { name: 'Equipment', exact: true }).click();
    await page.getByRole('option', { name: 'Dumbbell', exact: true }).click();
    await custom.getByText('More options', { exact: true }).click();
    await custom.getByRole('button', { name: 'Per side', exact: true }).click();
    await expect(custom.getByRole('button', { name: 'Per side', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await custom.screenshot({ path: info.outputPath(`custom-${theme}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    const saved = page.waitForResponse(response => response.url().endsWith('/api/exercises/custom') && response.request().method() === 'POST');
    await custom.getByRole('button', { name: 'Create and map exercise', exact: true }).click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBeTruthy();
    const side = await response.json();
    sideId = side.id;
    expect(side.weightBasis).toBe('per_side');
    await expect(custom).toBeHidden();
    const totalResponse = await page.request.post('/api/exercises/custom', { headers, data: {
      name: `${name} machine`, muscle: 'Chest', equipment: 'Machine', loadModel: 'external', weightBasis: 'total'
    } });
    expect(totalResponse.ok(), await totalResponse.text()).toBeTruthy();
    const total = await totalResponse.json();
    totalId = total.id;
    const catalog = await (await page.request.get('/api/exercises')).json();
    expect(catalog.find((row: { id: string }) => row.id === sideId).weightBasis).toBe('per_side');
    const created = await page.request.post('/api/templates', { headers, data: {
      name: 'Weight convention', focus: 'Chest', exercises: [side, total].map(exercise => ({
        exerciseId: exercise.id, sourceName: exercise.name,
        sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 0, warmup: false }]
      }))
    } });
    expect(created.ok(), await created.text()).toBeTruthy();
    templateId = (await created.json()).id;
    const started = await page.request.post('/api/workouts', { headers, data: { templateId } });
    expect(started.ok(), await started.text()).toBeTruthy();
    sessionId = (await started.json()).id;
    for (const theme of ['dark', 'light']) {
      for (const unit of ['kg', 'lb']) {
        const prefs = await page.request.put('/api/preferences', { headers, data: { ...original.preferences, theme, unit } });
        expect(prefs.ok(), await prefs.text()).toBeTruthy();
        await page.goto('/');
        const workout = page.getByRole('dialog', { name: 'Weight convention', exact: true });
        await expect(workout).toBeVisible();
        await workout.getByRole('tab', { name: `${name}, 0 of 1 sets completed`, exact: true }).click();
        await expect(workout.locator('.col-load').filter({ visible: true })).toHaveText(`${unit}/side`);
        await expect(workout.getByRole('spinbutton', { name: `${name} set 1 weight per side`, exact: true })).toBeVisible();
        await checkGeometry(page);
        await workout.screenshot({ path: info.outputPath(`per-side-${theme}-${unit}.png`) });
        await workout.getByRole('tab', { name: `${total.name}, 0 of 1 sets completed`, exact: true }).click();
        await expect(workout.locator('.col-load').filter({ visible: true })).toHaveText(unit);
        await checkGeometry(page);
      }
    }
  } finally {
    if (sessionId) await page.request.post(`/api/workouts/${sessionId}/discard`, { headers });
    if (templateId) await page.request.delete(`/api/templates/${templateId}`, { headers });
    if (sideId) await page.request.delete(`/api/exercises/custom/${sideId}`, { headers });
    if (totalId) await page.request.delete(`/api/exercises/custom/${totalId}`, { headers });
    await page.request.put('/api/preferences', { headers, data: original.preferences });
  }
});

test('Settings edits another gym’s weights without switching gyms', async ({ page }, info) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  if (bootstrap.activeWorkout?.active)
    await page.request.post(`/api/workouts/${bootstrap.activeWorkout.id}/discard`, { headers });
  const original = bootstrap.preferences;
  const gymsBeforeEdit = await page.request.get('/api/gyms');
  expect(gymsBeforeEdit.ok(), await gymsBeforeEdit.text()).toBeTruthy();
  const overview = await (await page.request.get('/api/load-settings?unit=kg')).json();
  const activeCable = overview.equipment.find((item: { group: string }) => item.group === 'cable');
  const name = `Hotel gym ${info.project.name}`;
  const created = await page.request.post('/api/gyms', { headers, data: { name } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const gymId = (await created.json()).profiles.find((profile: { name: string }) => profile.name === name).id;

  try {
    const preferences = await page.request.put('/api/preferences', { headers, data: { ...original, unit: 'kg' } });
    expect(preferences.ok()).toBeTruthy();
    await page.goto('/settings');
    const gyms = page.getByRole('region', { name: 'Gyms', exact: true });
    const defaults = gyms.getByRole('article', { name: 'Equipment defaults' });
    const select = defaults.getByRole('button', { name: 'Gym for weight increments' });
    await expect(select).toContainText('(in use)');
    const editCable = defaults.getByRole('button', { name: 'Edit Cable weights', exact: true });
    await expect(editCable).toBeVisible();
    const beforeSwitch = await defaults.boundingBox();
    let releaseWeights!: () => void;
    const waitForWeights = new Promise<void>(resolve => { releaseWeights = resolve; });
    const gymWeights = `**/api/gyms/${gymId}/load-settings?unit=kg`;
    await page.route(gymWeights, async route => {
      await waitForWeights;
      await route.continue();
    });
    await select.click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(select).toHaveText(name);
    try {
      await expect(defaults.getByRole('status')).toHaveText(`Loading weights for ${name}…`);
      const staleEdit = defaults.locator('button[aria-label="Edit Cable weights"]');
      expect(await staleEdit.evaluate(button => {
        button.focus();
        return document.activeElement === button;
      })).toBe(false);
      expect((await defaults.boundingBox())?.height).toBe(beforeSwitch?.height);
    } finally {
      releaseWeights();
    }
    await expect(defaults.getByRole('status')).toBeHidden();
    await page.unroute(gymWeights);
    await editCable.click();
    const editor = page.getByRole('dialog', { name: 'Cable weights', exact: true });
    await expect(editor.getByText(`Weight settings for ${name}.`)).toBeVisible();
    await editor.getByRole('spinbutton', { name: 'Weight increase (kg)', exact: true }).fill('7.5');
    await editor.getByRole('button', { name: 'Save weights', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(defaults.getByText(/7\.5 kg steps/)).toBeVisible();

    const refreshed = await (await page.request.get('/api/load-settings?unit=kg')).json();
    expect(refreshed.gymProfileId).toBe(overview.gymProfileId);
    expect(refreshed.equipment.find((item: { group: string }) => item.group === 'cable')).toEqual(activeCable);
    await page.reload();
    await select.click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(defaults.getByText(/7\.5 kg steps/)).toBeVisible();
    for (const theme of ['dark', 'light']) {
      await page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= Math.round(visualViewport!.width) + 1)).toBe(true);
      await gyms.screenshot({ path: info.outputPath(`gym-weight-settings-${theme}.png`) });
    }
  } finally {
    await page.request.put('/api/preferences', { headers, data: original });
    await page.request.delete(`/api/gyms/${gymId}`, { headers });
  }
});
