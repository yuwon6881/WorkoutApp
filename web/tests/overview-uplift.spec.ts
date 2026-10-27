import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

test('navigation previews the next workout and creates a session only after Start', async ({ page }, info) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const initial = await (await page.request.get('/api/bootstrap')).json();
  if (initial.activeWorkout?.active) {
    const discarded = await page.request.post(`/api/workouts/${initial.activeWorkout.id}/discard`, { headers });
    expect(discarded.ok(), await discarded.text()).toBeTruthy();
  }
  const catalog = await (await page.request.get('/api/exercises')).json();
  const exercise = catalog.find((row: { slug: string }) => row.slug === 'barbell-bench-press') ?? catalog[0];
  const name = `Navigation preview ${info.project.name}`;
  const created = await page.request.post('/api/templates', { headers, data: {
    name, note: 'Preview coaching note', focus: 'Chest', exercises: [{ exerciseId: exercise.id, sourceName: exercise.name,
      sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90, warmup: false }] }]
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const template = await created.json();
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/workouts') starts++; });
  await page.route('**/api/bootstrap/launch', async route => {
    const response = await route.fetch();
    const launch = await response.json();
    launch.nextWorkout = { id: template.id, name, week: 1, position: 0, focus: 'Chest', exerciseCount: 1 };
    await route.fulfill({ json: launch });
  });
  try {
    await page.goto('/');
    const action = page.getByRole('button', { name: 'Start next workout', exact: true }).filter({ visible: true });
    await action.click();
    const preview = page.getByRole('dialog', { name, exact: true });
    await expect(preview.locator('.readonly-exercise-name')).toHaveText(exercise.name);
    await expect(preview.getByText('Preview coaching note', { exact: true })).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
    await preview.screenshot({ path: info.outputPath('workout-preview.png') });
    expect(starts).toBe(0);
    expect((await (await page.request.get('/api/bootstrap')).json()).activeWorkout).toBeNull();
    await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(preview).toBeHidden();
    await action.click();
    await preview.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page.getByRole('dialog', { name, exact: true }).locator('.workout-set-row')).toBeVisible();
    expect(starts).toBe(1);
  } finally {
    const current = await (await page.request.get('/api/bootstrap')).json();
    if (current.activeWorkout?.active) {
      const discarded = await page.request.post(`/api/workouts/${current.activeWorkout.id}/discard`, { headers });
      expect(discarded.ok(), await discarded.text()).toBeTruthy();
    }
    await page.request.delete(`/api/templates/${template.id}`, { headers });
  }
});

test('a Start tapped on the remembered launch summary previews the next workout the server confirms', async ({ page }, info) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const initial = await (await page.request.get('/api/bootstrap')).json();
  if (initial.activeWorkout?.active) {
    const discarded = await page.request.post(`/api/workouts/${initial.activeWorkout.id}/discard`, { headers });
    expect(discarded.ok(), await discarded.text()).toBeTruthy();
  }
  const catalog = await (await page.request.get('/api/exercises')).json();
  const exercise = catalog.find((row: { slug: string }) => row.slug === 'barbell-bench-press') ?? catalog[0];
  const name = `Confirmed preview ${info.project.name}`;
  const created = await page.request.post('/api/templates', { headers, data: {
    name, note: 'Preview coaching note', focus: 'Chest', exercises: [{ exerciseId: exercise.id, sourceName: exercise.name,
      sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90, warmup: false }] }]
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const template = await created.json();
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/workouts') starts++; });
  await page.route('**/api/bootstrap/launch', async route => {
    // A slow live read leaves the remembered summary on screen while Start is tapped.
    await new Promise(resolve => setTimeout(resolve, 1500));
    const response = await route.fetch();
    const launch = await response.json();
    launch.nextWorkout = { id: template.id, name, week: 1, position: 0, focus: 'Chest', exerciseCount: 1 };
    await route.fulfill({ json: launch });
  });
  const stale = await (await page.request.post('/api/templates', { headers, data: {
    name: `Remembered plan ${info.project.name}`, note: '', focus: 'Back', exercises: [] } })).json();
  // The device remembers a different next workout than the server is about to report.
  await page.evaluate(staleId => {
    const raw = localStorage.getItem('workout-launch-snapshot');
    if (!raw) throw new Error('Signing in should have saved a launch summary.');
    const stored = JSON.parse(raw);
    stored.shell.nextWorkout = { id: staleId, name: 'Remembered plan', week: 1, position: 0, focus: 'Back', exerciseCount: 0 };
    localStorage.setItem('workout-launch-snapshot', JSON.stringify(stored));
  }, stale.id);
  try {
    await page.goto('/');
    const action = page.getByRole('button', { name: 'Start next workout', exact: true }).filter({ visible: true });
    await action.click();
    const preview = page.getByRole('dialog', { name, exact: true });
    await expect(preview.locator('.readonly-exercise-name')).toHaveText(exercise.name);
    await expect(preview.getByText('Preview coaching note', { exact: true })).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Start workout', exact: true })).toBeEnabled();
    await preview.screenshot({ path: info.outputPath('workout-preview.png') });
    expect(starts).toBe(0);
    expect((await (await page.request.get('/api/bootstrap')).json()).activeWorkout).toBeNull();
    await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(preview).toBeHidden();
    await action.click();
    await preview.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(page.getByRole('dialog', { name, exact: true }).locator('.workout-set-row')).toBeVisible();
    expect(starts).toBe(1);
  } finally {
    const current = await (await page.request.get('/api/bootstrap')).json();
    if (current.activeWorkout?.active) {
      const discarded = await page.request.post(`/api/workouts/${current.activeWorkout.id}/discard`, { headers });
      expect(discarded.ok(), await discarded.text()).toBeTruthy();
    }
    await page.request.delete(`/api/templates/${template.id}`, { headers });
    await page.request.delete(`/api/templates/${stale.id}`, { headers });
  }
});

test('weekly totals follow calendar navigation while its controls stay fixed', async ({ page }, info) => {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const day = (offset: number) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  await page.route('**/api/workouts/activity?*', route => route.fulfill({ json: [
    { id: 'current', name: 'Current', date: day(0), status: 'completed', workingSets: 12, trainingMinutes: 40 },
    { id: 'past', name: 'Past', date: day(-7), status: 'completed', workingSets: 6, trainingMinutes: 20 },
    { id: 'active', name: 'Active', date: day(1), status: 'in_progress', workingSets: null, trainingMinutes: null }
  ] }));
  await signIn(page);
  const stats = page.getByRole('region', { name: 'Training statistics' });
  await expect(stats.locator('.stat-card-value')).toHaveText(['1', '12', '40 min']);
  const nav = page.locator('.calendar-month-nav');
  const before = (await nav.boundingBox())!;
  await page.locator('.calendar-week-rail').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(stats.locator('.stat-card-value')).toHaveText(['1', '6', '20 min']);
  await page.screenshot({ path: info.outputPath('overview-past-week.png'), fullPage: true });
  const after = (await nav.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Return to this week' }).click();
  await expect(stats.locator('.stat-card-value')).toHaveText(['1', '12', '40 min']);
  await page.locator('.calendar-week-rail').focus();
  await page.keyboard.press('ArrowRight');
  await expect(stats.locator('.stat-card-value')).toHaveText(['0', '0', '0 min']);
});
