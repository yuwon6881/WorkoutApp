import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

test('program finish waits for review even when the saved exercise has no restore flag', async ({ page }, info) => {
  await signIn(page, 'e2e-lifter');
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const active = await (await page.request.get('/api/workouts/active')).json();
  if (active) {
    const discardActive = await page.request.post(`/api/workouts/${active.id}/discard`, { headers });
    expect(discardActive.ok(), await discardActive.text()).toBeTruthy();
  }
  const catalog = await (await page.request.get('/api/exercises')).json();
  const bench = catalog.find((exercise: { name: string }) => exercise.name === 'Barbell bench press') ?? catalog[0];
  const exercise = { exerciseId: bench.id, sourceName: bench.name, sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90 }] };
  const created = await page.request.post('/api/programs', { headers, data: {
    name: `Finish review ${info.project.name} ${Date.now()}`,
    workouts: [{ week: 1, name: 'First', exercises: [exercise] }, { week: 2, name: 'Second', exercises: [exercise] }]
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const program = await created.json();
  let sessionId: string | undefined;
  let release!: () => void;
  const reviewing = new Promise<void>(resolve => { release = resolve; });
  try {
    if (!program.active) {
      const activated = await page.request.post(`/api/programs/${program.id}/active`, {
        headers, data: { active: true, revision: program.revision }
      });
      expect(activated.ok(), await activated.text()).toBeTruthy();
    }
    const started = await page.request.post('/api/workouts', { headers, data: { templateId: program.workouts[0].id } });
    expect(started.ok(), await started.text()).toBeTruthy();
    const session = await started.json();
    sessionId = session.id;
    const logged = await page.request.patch(`/api/workouts/${session.id}/sets/${session.exercises[0].sets[0].id}`, {
      headers, data: { revision: session.revision, mutationId: crypto.randomUUID(), weightKg: 60, reps: 8, rpe: 8, done: true }
    });
    expect(logged.ok(), await logged.text()).toBeTruthy();
    expect((await logged.json()).exercises[0].canRestore).toBe(false);
    let reviews = 0;
    await page.route(`**/api/workouts/${session.id}/finish/preview`, async route => {
      reviews++;
      await reviewing;
      if (!page.isClosed()) await route.continue();
    });

    // On launch with an active workout, the app contract deterministically auto-opens the workout sheet
    await page.goto('/');
    const sheet = page.getByRole('dialog', { name: session.name, exact: true });
    await expect(sheet).toBeVisible();
    const options = page.getByRole('button', { name: 'Workout options', exact: true });
    await expect(options).toBeVisible();
    await options.click();

    await page.getByRole('menuitem', { name: 'Finish workout', exact: true }).click();
    const save = page.getByRole('button', { name: 'Save workout', exact: true });
    await expect.poll(() => reviews).toBe(1);
    await expect(save).toBeDisabled();
    release();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Workout complete', { exact: true })).toBeVisible();
  } finally {
    release?.();
    if (!page.isClosed()) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      try {
        if (sessionId) {
          const check = await page.request.get(`/api/workouts/${sessionId}`);
          if (check.ok()) {
            const latest = await check.json();
            if (latest?.active) {
              const res = await page.request.post(`/api/workouts/${sessionId}/discard`, { headers });
              expect(res.ok(), await res.text()).toBeTruthy();
            } else {
              const res = await page.request.delete(`/api/workouts/${sessionId}`, { headers });
              expect(res.ok(), await res.text()).toBeTruthy();
            }
          } else {
            expect(check.ok(), await check.text()).toBeTruthy();
          }
        }
      } finally {
        if (program?.id) {
          const res = await page.request.delete(`/api/programs/${program.id}`, { headers });
          expect(res.ok(), await res.text()).toBeTruthy();
        }
      }
    }
  }
});
