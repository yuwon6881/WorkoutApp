import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { join } from 'node:path';
import { signIn } from './signIn';

const USER = 'e2e-lifter';
const screenshotsDirectory = process.env.WORKOUT_TEST_SCREENSHOTS || 'artifacts';

type Headers = Record<string, string>;
type Slot = { programId: string | null; templateId: string | null };

/// Drags a card by its grip onto a zone with real pointer movement, the way a mouse user would.
async function dragTo(page: Page, card: Locator, zone: Locator) {
  const grip = card.locator('[data-slot-grip]').first();
  await grip.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const from = (await grip.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Keep the target clear of the edges, where a held drag scrolls the page instead.
  await zone.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const to = (await zone.boundingBox())!;
  const viewport = page.viewportSize()!;
  const y = Math.min(Math.max(to.y + Math.min(to.height / 2, 60), 140), viewport.height - 180);
  await page.mouse.move(to.x + to.width / 2, y, { steps: 12 });
  await page.mouse.up();
}

async function bootstrap(request: APIRequestContext) {
  const response = await request.get('/api/bootstrap');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function currentSlot(request: APIRequestContext): Promise<Slot> {
  const data = await bootstrap(request);
  return {
    programId: data.programs.find((program: { active: boolean }) => program.active)?.id ?? null,
    templateId: data.templates.find((template: { active?: boolean }) => template.active)?.id ?? null
  };
}

async function vacate(request: APIRequestContext, headers: Headers) {
  const data = await bootstrap(request);
  for (const program of data.programs.filter((item: { active: boolean }) => item.active))
    await request.post(`/api/programs/${program.id}/active`, { headers, data: { active: false, revision: program.revision } });
  for (const template of data.templates.filter((item: { active?: boolean }) => item.active))
    await request.post(`/api/templates/${template.id}/active`, { headers, data: { active: false, revision: template.revision } });
}

async function finishWorkout(request: APIRequestContext, headers: Headers, templateId: string) {
  const started = await request.post('/api/workouts', { headers, data: { templateId } });
  expect(started.ok(), await started.text()).toBeTruthy();
  const session = await started.json();
  const exercise = session.exercises[0];
  const saved = await request.put(`/api/workouts/${session.id}`, { headers, data: {
    note: null, revision: session.revision, idempotencyId: null,
    exercises: [{ exerciseId: exercise.exerciseId, nameSnapshot: exercise.name, note: null, prescription: exercise.prescription,
      sets: [{ weightKg: 60, reps: 8, rpe: 8, done: true }] }]
  } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const finished = await request.post(`/api/workouts/${session.id}/finish`, { headers, data: { revision: (await saved.json()).revision } });
  expect(finished.ok(), await finished.text()).toBeTruthy();
}

test('workouts move between the library and the active slot, forgetting progress only after confirmation', async ({ page }, info) => {
  await signIn(page, USER);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const active = await (await page.request.get('/api/workouts/active')).json();
  if (active) await page.request.post(`/api/workouts/${active.id}/discard`, { headers });
  const original = await currentSlot(page.request);
  const stamp = `${info.project.name} ${Date.now()}`;
  const programName = `Slot program ${stamp}`;
  const workoutName = `Slot workout ${stamp}`;
  let programId: string | null = null;
  let templateId: string | null = null;
  try {
    const catalog = await (await page.request.get('/api/exercises')).json();
    const bench = catalog.find((exercise: { name: string }) => exercise.name === 'Barbell bench press') ?? catalog[0];
    const exercise = { exerciseId: bench.id, sourceName: bench.name, sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90 }] };
    await vacate(page.request, headers);
    const program = await page.request.post('/api/programs', { headers, data: { name: programName, workouts: [
      { week: 1, name: 'Upper A', exercises: [exercise] },
      { week: 1, name: 'Lower A', exercises: [exercise] },
      { week: 2, name: 'Upper B', exercises: [exercise] }
    ] } });
    expect(program.ok(), await program.text()).toBeTruthy();
    const created = await program.json();
    programId = created.id;
    await page.request.post(`/api/programs/${programId}/active`, { headers, data: { active: false, revision: created.revision } });
    const template = await page.request.post('/api/templates', { headers, data: { name: workoutName, exercises: [exercise] } });
    expect(template.ok(), await template.text()).toBeTruthy();
    templateId = (await template.json()).id;

    await page.goto('/workouts');
    const zone = page.locator('[data-slot-zone="active"]');
    const library = page.locator('[data-slot-zone="library"]');
    await expect(zone.getByRole('heading', { name: 'Drag a workout here to activate it' })).toBeVisible();
    const libraryCard = library.locator('.library-program-card').filter({ hasText: programName });
    await expect(libraryCard.getByText(/PDF|passed/)).toHaveCount(0);
    await page.screenshot({ path: join(screenshotsDirectory, `${info.project.name}-workout-slot-empty.png`), fullPage: true });

    // Expanded, a library program is the builder's timeline with nothing editable.
    await libraryCard.getByRole('button', { name: `Expand ${programName}`, exact: true }).click();
    await expect(libraryCard.getByRole('button', { name: 'Upper A', exact: true })).toBeVisible();
    await expect(libraryCard.getByRole('button', { name: /^Reorder |^Actions for Upper A|Add workout day/ })).toHaveCount(0);
    await page.screenshot({ path: join(screenshotsDirectory, `${info.project.name}-workout-slot-library-expanded.png`), fullPage: true });
    await libraryCard.getByRole('button', { name: 'Upper A', exact: true }).click();
    const dayView = page.locator('.day-detail-modal');
    await expect(dayView.locator('.readonly-exercise')).toHaveCount(1);
    await expect(dayView.getByRole('textbox')).toHaveCount(0);
    await page.screenshot({ path: join(screenshotsDirectory, `${info.project.name}-workout-slot-library-day.png`) });
    await dayView.getByRole('button', { name: 'Done', exact: true }).click();
    // The header toggles in both directions, anywhere on it.
    await libraryCard.locator('.slot-card-title').click();
    await expect(libraryCard.getByRole('button', { name: `Expand ${programName}`, exact: true })).toBeVisible();
    await libraryCard.locator('.slot-card-title').click();
    await expect(libraryCard.getByRole('button', { name: `Collapse ${programName}`, exact: true })).toBeVisible();

    // Lifting an open card by its grip folds it down, so it is easy to carry. Dropping it where it
    // started leaves it in the library.
    const grip = libraryCard.locator('[data-slot-grip]').first();
    const gripBox = (await grip.boundingBox())!;
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + gripBox.width / 2 + 24, gripBox.y + gripBox.height / 2 + 24, { steps: 6 });
    await expect(libraryCard.getByRole('button', { name: `Expand ${programName}`, exact: true })).toBeVisible();
    await expect(libraryCard.getByRole('button', { name: 'Upper A', exact: true })).toHaveCount(0);
    await page.mouse.up();

    await dragTo(page, libraryCard, zone);
    const activeCard = zone.locator('.program-card').filter({ hasText: programName });
    await expect(activeCard.getByText('Active', { exact: true })).toBeVisible();
    await expect(activeCard.getByRole('button', { name: `Collapse ${programName}`, exact: true })).toBeVisible();
    await expect(activeCard.getByRole('button', { name: 'Upper A', exact: true })).toBeVisible();
    await expect(library.locator('.library-program-card').filter({ hasText: programName })).toHaveCount(0);

    // Dragging an active program collapses it; releasing it on active workout expands it.
    const activeGrip = activeCard.locator('[data-slot-grip]').first();
    const activeGripBox = (await activeGrip.boundingBox())!;
    await page.mouse.move(activeGripBox.x + activeGripBox.width / 2, activeGripBox.y + activeGripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(activeGripBox.x + activeGripBox.width / 2 + 20, activeGripBox.y + activeGripBox.height / 2 + 20, { steps: 6 });
    await expect(activeCard.getByRole('button', { name: `Expand ${programName}`, exact: true })).toBeVisible();
    await page.mouse.up();
    await expect(activeCard.getByRole('button', { name: `Collapse ${programName}`, exact: true })).toBeVisible();

    // Passing a day is progress, so taking the program out now asks first; Cancel leaves it put.
    await finishWorkout(page.request, headers, created.workouts[0].id);
    await page.reload();
    await expect(activeCard.getByText(/1 of 2 days passed/)).toBeVisible();
    await page.screenshot({ path: join(screenshotsDirectory, `${info.project.name}-workout-slot-active.png`), fullPage: true });
    await dragTo(page, activeCard, library);
    const forget = page.getByRole('dialog', { name: `Move ${programName} to the library?` });
    await expect(forget).toBeVisible();
    await page.screenshot({ path: join(screenshotsDirectory, `${info.project.name}-workout-slot-confirm.png`) });
    await forget.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(forget).toBeHidden();
    await expect(activeCard).toBeVisible();
    await expect(activeCard.getByText(/1 of 2 days passed/)).toBeVisible();
    await expect(activeCard.getByRole('button', { name: `Collapse ${programName}`, exact: true })).toBeVisible();

    await dragTo(page, activeCard, library);
    await page.getByRole('dialog', { name: `Move ${programName} to the library?` })
      .getByRole('button', { name: 'Move and forget progress', exact: true }).click();
    const parkedCard = library.locator('.library-program-card').filter({ hasText: programName });
    await expect(parkedCard).toBeVisible();
    await expect(parkedCard.getByRole('button', { name: `Expand ${programName}`, exact: true })).toBeVisible();
    await expect(zone.getByRole('heading', { name: 'Drag a workout here to activate it' })).toBeVisible();
    const parked = await (await page.request.get(`/api/programs/${programId}`)).json();
    expect(parked.active).toBe(false);
    expect(parked.progress).toBeNull();

    // A standalone workout activated from its menu is a one-day run that ticks itself when done.
    const routine = library.locator('.routine-card').filter({ hasText: workoutName });
    await routine.getByRole('button', { name: `Actions for ${workoutName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Make active', exact: true }).click();
    const activeWorkout = zone.locator('.template-slot-card').filter({ hasText: workoutName });
    await expect(activeWorkout.getByRole('img', { name: 'Not completed yet' })).toBeVisible();
    await finishWorkout(page.request, headers, templateId!);
    await page.reload();
    await expect(activeWorkout.getByRole('img', { name: 'Completed' })).toBeVisible();
    await expect(activeWorkout.getByText(`${workoutName} is finished`)).toBeVisible();
    await page.screenshot({ path: join(screenshotsDirectory, `${info.project.name}-workout-slot-finished.png`), fullPage: true });
    await activeWorkout.getByRole('button', { name: 'Restart', exact: true }).click();
    await expect(activeWorkout.getByRole('img', { name: 'Not completed yet' })).toBeVisible();
    await activeWorkout.getByRole('button', { name: `Actions for ${workoutName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to library', exact: true }).click();
    await expect(library.locator('.routine-card').filter({ hasText: workoutName })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  } finally {
    if (programId) await page.request.delete(`/api/programs/${programId}`, { headers }).catch(() => {});
    if (templateId) await page.request.delete(`/api/templates/${templateId}`, { headers }).catch(() => {});
    const data = await bootstrap(page.request).catch(() => null);
    if (data && original.programId) {
      const program = data.programs.find((item: { id: string }) => item.id === original.programId);
      if (program && !program.active) await page.request.post(`/api/programs/${program.id}/active`, { headers, data: { active: true, revision: program.revision } });
    }
    if (data && original.templateId) {
      const template = data.templates.find((item: { id: string }) => item.id === original.templateId);
      if (template && !template.active) await page.request.post(`/api/templates/${template.id}/active`, { headers, data: { active: true, revision: template.revision } });
    }
  }
});
