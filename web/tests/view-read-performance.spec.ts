import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

test.use({ serviceWorkers: 'block', actionTimeout: 10000 });

test('the library loading skeleton follows its responsive layout in both themes', async ({ page }, info) => {
  await signIn(page);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/exercises', async route => { await ready; await route.continue(); });
  try {
    await page.goto('/exercises', { waitUntil: 'domcontentloaded' });
    const skeleton = page.getByRole('status', { name: 'Loading Exercises', exact: true });
    await expect(skeleton).toBeVisible();
    await expect(skeleton.locator('.view-skeleton-exercise')).toHaveCount(6);
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth,
        viewport: Math.round(visualViewport?.width ?? innerWidth) }));
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1);
      await page.screenshot({ path: info.outputPath(`library-skeleton-${theme}.png`), fullPage: true });
    }
  } finally { release(); }
  await expect(page.getByRole('textbox', { name: 'Search exercises', exact: true })).toBeVisible();
});

test('library metadata and insight ranges survive a return visit in memory', async ({ page }, info) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  // Replacing an older remembered launch correctly invalidates reads. Measure reuse only after
  // starting from the confirmed shell, rather than racing that independent startup transition.
  await page.evaluate(() => localStorage.removeItem('workout-launch-snapshot'));
  // Exercise reuse inside the freshness window even on a slow browser runner; expiry is covered
  // by viewReadCache.test.ts, and real timers keep driving the UI.
  await page.clock.setFixedTime(Date.now());
  const catalog = await (await page.request.get('/api/exercises')).json();
  const exercise = catalog[0];
  const created = await page.request.post('/api/templates', { headers, data: {
    name: `Cached plan ${info.project.name} ${Date.now()}`, focus: '', note: '',
    exercises: [{ exerciseId: exercise.id, sourceName: exercise.name, sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90, warmup: false }] }]
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const template = await created.json();
  const baseline = await (await page.request.get(`/api/exercises/${exercise.id}/insight?range=3m&page=0&size=20`)).json();
  let metadataReads = 0;
  const rangeReads = new Map<string, number>();
  await page.route('**/api/bootstrap/launch', async route => {
    const response = await route.fetch();
    const launch = await response.json();
    await route.fulfill({ json: {
      ...launch,
      activeWorkout: null,
      nextWorkout: { id: template.id, name: template.name, week: 1, position: 0, focus: '', exerciseCount: 1 }
    } });
  });
  await page.route('**/api/exercises/last-performed', route => {
    metadataReads++;
    return route.fulfill({ json: [{ exerciseId: exercise.id, weightKg: 100, reps: 8, durationSeconds: null, finishedAt: '2026-10-27T12:00:00Z' }] });
  });
  await page.route(`**/api/exercises/${exercise.id}/insight?*`, route => {
    const url = new URL(route.request().url());
    const range = url.searchParams.get('range')!;
    const pageIndex = Number(url.searchParams.get('page') ?? '0');
    rangeReads.set(range, (rangeReads.get(range) ?? 0) + 1);
    const pageZeroRow = { sessionId: 's-1', sessionName: 'Upper Alpha', date: '2026-10-27', setCount: 3, volumeKg: 900, partial: false, finishedAt: '2026-10-27T12:00:00Z', programName: null };
    const pageOneRow = { sessionId: 's-2', sessionName: 'Upper Beta', date: '2026-10-20', setCount: 3, volumeKg: 840, partial: false, finishedAt: '2026-10-20T12:00:00Z', programName: null };
    const points = baseline.points.length >= 2 ? baseline.points : [
      { sessionId: 's-2', date: '2026-10-20', loadKg: 95, reps: 8, volumeKg: 840, estimated1RmKg: 120, partial: false },
      { sessionId: 's-1', date: '2026-10-27', loadKg: 100, reps: 8, volumeKg: 900, estimated1RmKg: 127, partial: false }
    ];
    return route.fulfill({ json: {
      ...baseline, points, sessions: 2, totalHistoryRows: 2, setCount: 6,
      history: range === '1m' ? [pageZeroRow] : pageIndex === 0 ? [pageZeroRow] : [pageOneRow]
    } });
  });
  try {
    await page.goto('/exercises');
    await expect.poll(() => metadataReads).toBe(1);
    await page.getByRole('textbox', { name: 'Search exercises', exact: true }).fill(exercise.name);
    await page.getByRole('button', { name: `View ${exercise.name} details`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: exercise.name, exact: true });
    await dialog.getByRole('button', { name: 'History', exact: true }).click();
    await expect(dialog.getByText('Upper Alpha')).toBeVisible();
    await dialog.getByRole('button', { name: 'Load more history', exact: true }).click();
    await expect(dialog.getByText('Upper Beta')).toBeVisible();
    await dialog.getByRole('button', { name: 'Progress', exact: true }).click();
    await dialog.getByRole('button', { name: 'Progress range' }).click();
    await page.getByRole('option', { name: 'Last month', exact: true }).click();
    await expect.poll(() => rangeReads.get('1m')).toBe(1);
    await dialog.getByRole('button', { name: 'Progress range' }).click();
    await page.getByRole('option', { name: 'Last 3 months', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Progress range' })).toContainText('Last 3 months');
    await dialog.getByRole('button', { name: 'History', exact: true }).click();
    await expect(dialog.getByText('Upper Alpha')).toBeVisible();
    await expect(dialog.getByText('Upper Beta')).toBeVisible();
    expect(rangeReads.get('3m')).toBe(2);
    await dialog.screenshot({ path: info.outputPath('cached-insight.png') });
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Overview', exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    // NextWorkoutPlan on Overview must reuse the cached last-performed metadata rather than fetching it again.
    await expect(page.locator('.hero-plan')).toBeVisible();
    await expect(page.locator('.hero-plan')).toContainText(exercise.name);
    await page.getByRole('button', { name: 'Exercises', exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'Search exercises', exact: true })).toBeVisible();
    expect(metadataReads).toBe(1);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.request.delete(`/api/templates/${template.id}`, { headers });
  }
});

test('overview next-workout plan shares last-performed metadata with the library', async ({ page }, info) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  await page.evaluate(() => localStorage.removeItem('workout-launch-snapshot'));
  await page.clock.setFixedTime(Date.now());
  const catalog = await (await page.request.get('/api/exercises')).json();
  const exercise = catalog[0];
  const created = await page.request.post('/api/templates', { headers, data: {
    name: `Overview share ${info.project.name} ${Date.now()}`, focus: '', note: '',
    exercises: [{ exerciseId: exercise.id, sourceName: exercise.name, sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90, warmup: false }] }]
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const template = await created.json();
  let metadataReads = 0;
  let templateReads = 0;
  await page.route('**/api/bootstrap/launch', async route => {
    const response = await route.fetch();
    const launch = await response.json();
    await route.fulfill({ json: {
      ...launch,
      activeWorkout: null,
      nextWorkout: { id: template.id, name: template.name, week: 1, position: 0, focus: '', exerciseCount: 1 }
    } });
  });
  await page.route(`**/api/templates/${template.id}`, route => {
    templateReads++;
    return route.continue();
  });
  await page.route('**/api/exercises/last-performed', route => {
    metadataReads++;
    return route.fulfill({ json: [{ exerciseId: exercise.id, weightKg: 100, reps: 8, durationSeconds: null, finishedAt: '2026-10-27T12:00:00Z' }] });
  });
  try {
    await page.goto('/');
    await expect(page.locator('.hero-plan')).toBeVisible();
    await expect(page.locator('.hero-plan')).toContainText(exercise.name);
    expect(metadataReads).toBe(1);
    expect(templateReads).toBe(1);
    await page.getByRole('button', { name: 'Exercises', exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'Search exercises', exact: true })).toBeVisible();
    expect(metadataReads).toBe(1);
    await page.getByRole('button', { name: 'Overview', exact: true }).filter({ visible: true }).first().click();
    await expect(page.locator('.hero-plan')).toBeVisible();
    expect(metadataReads).toBe(1);
    expect(templateReads).toBe(1);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.request.delete(`/api/templates/${template.id}`, { headers });
  }
});

test('active and library programs reuse cached details across tab switches', async ({ page }, info) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const initial = await (await page.request.get('/api/bootstrap')).json();
  const originalProgramId = initial.programs.find((item: { active: boolean }) => item.active)?.id as string | undefined;
  const originalTemplateId = initial.templates.find((item: { active?: boolean }) => item.active)?.id as string | undefined;
  await page.evaluate(() => localStorage.removeItem('workout-launch-snapshot'));
  await page.clock.setFixedTime(Date.now());
  const catalog = await (await page.request.get('/api/exercises')).json();
  const libraryName = `Library reuse ${info.project.name} ${Date.now()}`;
  const activeName = `Active reuse ${info.project.name} ${Date.now()}`;
  let libraryId: string | undefined;
  let activeId: string | undefined;
  try {
    const libCreated = await page.request.post('/api/programs', { headers, data: {
      name: libraryName, workouts: [{ week: 1, name: 'Cached Push Day', exercises: [{
        exerciseId: catalog[0].id, sourceName: catalog[0].name,
        sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90, warmup: false }]
      }] }]
    } });
    expect(libCreated.ok(), await libCreated.text()).toBeTruthy();
    const libProgram = await libCreated.json();
    libraryId = libProgram.id;
    const deactivated = await page.request.post(`/api/programs/${libraryId}/active`, {
      headers, data: { active: false, revision: libProgram.revision }
    });
    expect(deactivated.ok(), await deactivated.text()).toBeTruthy();

    const activeCreated = await page.request.post('/api/programs', { headers, data: {
      name: activeName, workouts: [{ week: 1, name: 'Cached Pull Day', exercises: [{
        exerciseId: catalog[0].id, sourceName: catalog[0].name,
        sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90, warmup: false }]
      }] }]
    } });
    expect(activeCreated.ok(), await activeCreated.text()).toBeTruthy();
    activeId = (await activeCreated.json()).id;

    let libraryReads = 0;
    let activeReads = 0;
    await page.route(`**/api/programs/${libraryId}`, route => {
      if (route.request().method() === 'GET') libraryReads++;
      return route.continue();
    });
    await page.route(`**/api/programs/${activeId}`, route => {
      if (route.request().method() === 'GET') activeReads++;
      return route.continue();
    });

    await page.goto('/workouts');
    const activeCard = page.locator('.slot-card.program-card').filter({ hasText: activeName }).first();
    await expect(activeCard).toBeVisible();
    await activeCard.getByRole('button', { name: 'View Cached Pull Day', exact: true }).click();
    await expect(activeCard.locator('.iex-name').first()).toHaveText(catalog[0].name);
    await activeCard.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect.poll(() => activeReads).toBe(1);

    const libraryCard = page.locator('.library-program-card').filter({ hasText: libraryName });
    await expect(libraryCard).toBeVisible();
    await libraryCard.getByRole('button', { name: `Expand ${libraryName}`, exact: true }).click();
    await expect(libraryCard.getByText('Cached Push Day')).toBeVisible();
    await expect.poll(() => libraryReads).toBe(1);

    await page.getByRole('button', { name: 'Overview', exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Workouts', exact: true }).filter({ visible: true }).first().click();

    await expect(activeCard).toBeVisible();
    await activeCard.getByRole('button', { name: 'View Cached Pull Day', exact: true }).click();
    await expect(activeCard.locator('.iex-name').first()).toHaveText(catalog[0].name);
    await activeCard.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(libraryCard).toBeVisible();
    await libraryCard.getByRole('button', { name: `Expand ${libraryName}`, exact: true }).click();
    await expect(libraryCard.getByText('Cached Push Day')).toBeVisible();
    expect(activeReads).toBe(1);
    expect(libraryReads).toBe(1);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    if (activeId) await page.request.delete(`/api/programs/${activeId}`, { headers }).catch(() => {});
    if (libraryId) await page.request.delete(`/api/programs/${libraryId}`, { headers }).catch(() => {});
    const current = await (await page.request.get('/api/bootstrap')).json().catch(() => null);
    if (current && originalProgramId) {
      const orig = current.programs.find((item: { id: string }) => item.id === originalProgramId);
      if (orig && !orig.active) await page.request.post(`/api/programs/${orig.id}/active`, { headers, data: { active: true, revision: orig.revision } }).catch(() => {});
    }
    if (current && originalTemplateId) {
      const orig = current.templates.find((item: { id: string }) => item.id === originalTemplateId);
      if (orig && !orig.active) await page.request.post(`/api/templates/${orig.id}/active`, { headers, data: { active: true, revision: orig.revision } }).catch(() => {});
    }
  }
});
