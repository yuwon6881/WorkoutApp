import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

// A swapped exercise with a set left unlogged, finished with "Whole program": one tap must be enough.
test('finishing a swapped workout with the whole-program update succeeds on the first try', async ({ page }, info) => {
  await signIn(page, 'e2e-lifter');
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const open = await (await page.request.get('/api/workouts/active')).json();
  if (open) await page.request.post(`/api/workouts/${open.id}/discard`, { headers });
  const catalog = await (await page.request.get('/api/exercises')).json();
  const bench = catalog.find((exercise: { name: string }) => exercise.name === 'Barbell bench press') ?? catalog[0];
  const other = catalog.find((exercise: { id: string }) => exercise.id !== bench.id);
  const set = { repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90 };
  const exercise = { exerciseId: bench.id, sourceName: bench.name, sets: [set, set, set], restSeconds: 120 };
  const created = await page.request.post('/api/programs', { headers, data: {
    name: `Swap finish ${info.project.name} ${Date.now()}`,
    workouts: [1, 2, 3].map(week => ({ week, name: `Day ${week}`, exercises: [exercise] }))
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const program = await created.json();
  let sessionId: string | undefined;
  try {
    if (!program.active) await page.request.post(`/api/programs/${program.id}/active`, { headers, data: { active: true, revision: program.revision } });
    const started = await page.request.post('/api/workouts', { headers, data: { templateId: program.workouts[0].id } });
    let session = await started.json();
    sessionId = session.id;
    const swapped = await page.request.post(`/api/workouts/${session.id}/substitution`, { headers, data: {
      sessionExerciseId: session.exercises[0].id, replacementExerciseId: other.id, replacementName: other.name,
      revision: session.revision, idempotencyId: crypto.randomUUID()
    } });
    expect(swapped.ok(), await swapped.text()).toBeTruthy();
    session = await swapped.json();
    for (const index of [0, 1]) {
      const logged = await page.request.patch(`/api/workouts/${session.id}/sets/${session.exercises[0].sets[index].id}`, {
        headers, data: { revision: session.revision, mutationId: crypto.randomUUID(), weightKg: 40, reps: 10, rpe: 8, done: true }
      });
      expect(logged.ok(), await logged.text()).toBeTruthy();
      session = await logged.json();
    }

    await page.goto('/');
    await expect(page.getByRole('dialog', { name: session.name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Workout options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Finish workout', exact: true }).click();
    await expect(page.getByText('unlogged set will be left out')).toBeVisible();
    await page.getByRole('radio', { name: /Whole program|Same block/ }).first().check();
    await expect(page.getByRole('button', { name: 'Save workout', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save workout', exact: true }).click();
    await expect(page.getByText('Workout complete', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/program changed before finishing/)).toHaveCount(0);

    // The update carried the swap and nothing else: every day keeps its three sets and its 120 s rest timer.
    const saved = await (await page.request.get(`/api/programs/${program.id}`)).json();
    for (const day of saved.workouts) {
      expect(day.exercises[0].exerciseId).toBe(other.id);
      expect(day.exercises[0].sets).toHaveLength(3);
      expect(day.exercises[0].restSeconds).toBe(120);
    }
  } finally {
    const active = await (await page.request.get('/api/workouts/active')).json().catch(() => null);
    if (active) await page.request.post(`/api/workouts/${active.id}/discard`, { headers }).catch(() => {});
    if (sessionId) await page.request.delete(`/api/workouts/${sessionId}`, { headers }).catch(() => {});
    await page.request.delete(`/api/programs/${program.id}`, { headers }).catch(() => {});
  }
});
