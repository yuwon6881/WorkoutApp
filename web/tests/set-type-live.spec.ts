import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

/// A set's type can change while the workout runs, from the set-number chip in the logger, and
/// the change survives a reload because it is saved with the workout.
test('a running workout set can change to myo-reps from its set chip', async ({ page }, info) => {
  await signIn(page, 'e2e-lifter');
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const active = await (await page.request.get('/api/workouts/active')).json();
  if (active) {
    const discarded = await page.request.post(`/api/workouts/${active.id}/discard`, { headers });
    expect(discarded.ok(), await discarded.text()).toBeTruthy();
  }
  const catalog = await (await page.request.get('/api/exercises')).json();
  const bench = catalog.find((exercise: { name: string }) => exercise.name === 'Barbell bench press') ?? catalog[0];
  const set = { repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90 };
  const template = await page.request.post('/api/templates', { headers, data: {
    name: `Live set type ${info.project.name} ${Date.now()}`, focus: '', note: '',
    exercises: [{ exerciseId: bench.id, sourceName: bench.name, sets: [set, set] }]
  } });
  expect(template.ok(), await template.text()).toBeTruthy();
  const templateId = (await template.json()).id as string;
  let sessionId: string | undefined;
  try {
    const started = await page.request.post('/api/workouts', { headers, data: { templateId } });
    expect(started.ok(), await started.text()).toBeTruthy();
    const session = await started.json();
    sessionId = session.id;

    await page.goto('/');
    const sheet = page.getByRole('dialog', { name: session.name, exact: true });
    await expect(sheet).toBeVisible();
    const chip = sheet.getByRole('button', { name: `Set type for ${bench.name} set 2: Set 2`, exact: true });
    await chip.click();
    await page.getByRole('option', { name: 'Myo-reps', exact: true }).click();
    await expect(sheet.getByRole('button', { name: `Set type for ${bench.name} set 2: Myo-reps 2`, exact: true })).toBeVisible();

    await expect.poll(async () => {
      const latest = await (await page.request.get(`/api/workouts/${session.id}`)).json();
      return JSON.stringify(latest.exercises[0].prescription[1]).toLowerCase().includes('myo');
    }, { timeout: 15000 }).toBe(true);
    await page.reload();
    await expect(page.getByRole('dialog', { name: session.name, exact: true })
      .getByRole('button', { name: `Set type for ${bench.name} set 2: Myo-reps 2`, exact: true })).toBeVisible();
    const pausedSheet = page.getByRole('dialog', { name: session.name, exact: true });
    await pausedSheet.getByRole('button', { name: `Set type for ${bench.name} set 2: Myo-reps 2`, exact: true }).click();
    await page.getByRole('option', { name: 'Pause set', exact: true }).click();
    await expect.poll(async () => {
      const latest = await (await page.request.get(`/api/workouts/${session.id}`)).json();
      return JSON.stringify(latest.exercises[0].prescription[1]).toLowerCase().includes('pause set');
    }, { timeout: 15000 }).toBe(true);
    await page.reload();
    await expect(page.getByRole('dialog', { name: session.name, exact: true })
      .getByRole('button', { name: `Set type for ${bench.name} set 2: Pause 2`, exact: true })).toBeVisible();
  } finally {
    if (sessionId) await page.request.post(`/api/workouts/${sessionId}/discard`, { headers });
    await page.request.delete(`/api/templates/${templateId}`, { headers });
  }
});

test('a running workout shows each set’s prescribed percentage', async ({ page }, info) => {
  await signIn(page, 'e2e-lifter');
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const active = await (await page.request.get('/api/workouts/active')).json();
  if (active) await page.request.post(`/api/workouts/${active.id}/discard`, { headers });
  const catalog = await (await page.request.get('/api/exercises')).json();
  const bench = catalog.find((exercise: { name: string }) => exercise.name === 'Barbell bench press');
  const maxUrl = `/api/exercises/${bench.id}/one-rep-max`;
  const savedMax = (await (await page.request.get(maxUrl)).json()).overrideKg as number | null;
  const set = { repMin: 8, repMax: 8, targetRpe: 8, restSeconds: 90 };
  const response = await page.request.post('/api/templates', { headers, data: {
    name: `Percentage targets ${info.project.name} ${Date.now()}`, focus: '', note: '',
    exercises: [{ exerciseId: bench.id, sourceName: bench.name, sets: [
      { ...set, loadText: '70%' }, { ...set, loadText: '82.5–87.5%' },
      { ...set, loadText: '60%', notes: 'Percentage of top set' }
    ] }]
  } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const templateId = (await response.json()).id as string;
  let sessionId: string | undefined;
  try {
    const saved = await page.request.put(maxUrl, { headers, data: { oneRepMaxKg: 100 } });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    const started = await page.request.post('/api/workouts', { headers, data: { templateId } });
    expect(started.ok(), await started.text()).toBeTruthy();
    const session = await started.json();
    sessionId = session.id;
    await page.goto('/');
    const sheet = page.getByRole('dialog', { name: session.name, exact: true });
    const rows = sheet.locator('.workout-set-row');
    await expect(rows.nth(0).locator('.set-percentage-target')).toHaveText('70% 1RM');
    await expect(rows.nth(1).locator('.set-percentage-target')).toHaveText('82.5–87.5% 1RM');
    await expect(rows.nth(2).locator('.set-percentage-target')).toHaveText('60% of top set');
    await expect(sheet.getByRole('spinbutton', { name: `${bench.name} set 1 weight`, exact: true })).toHaveValue('70');
    for (const row of await rows.all()) {
      const target = row.locator('.set-percentage-target');
      expect(await target.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    }
    await sheet.screenshot({ path: info.outputPath('percentage-targets.png'), animations: 'disabled' });
    if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await expect(rows.nth(1).locator('.set-percentage-target')).toBeVisible();
    await sheet.screenshot({ path: info.outputPath('percentage-targets-light.png'), animations: 'disabled' });
    await sheet.getByRole('button', { name: 'Targets', exact: true }).click();
    const targets = page.getByRole('dialog', { name: `${bench.name} targets` });
    await expect(targets.getByText('70% 1RM')).toBeVisible();
    await expect(targets.getByText('60% of top set')).toBeVisible();
  } finally {
    if (sessionId) await page.request.post(`/api/workouts/${sessionId}/discard`, { headers });
    await page.request.put(maxUrl, { headers, data: { oneRepMaxKg: savedMax } });
    await page.request.delete(`/api/templates/${templateId}`, { headers });
  }
});
