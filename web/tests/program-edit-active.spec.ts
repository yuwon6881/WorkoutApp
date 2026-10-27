import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { join } from 'node:path';
import { signIn } from './signIn';

const USER = 'e2e-lifter';
const screenshotsDirectory = process.env.WORKOUT_TEST_SCREENSHOTS || 'artifacts';

type Headers = Record<string, string>;

async function bootstrap(request: APIRequestContext) {
  const response = await request.get('/api/bootstrap');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function vacate(request: APIRequestContext, headers: Headers) {
  const data = await bootstrap(request);
  for (const program of data.programs.filter((item: { active: boolean }) => item.active))
    await request.post(`/api/programs/${program.id}/active`, { headers, data: { active: false, revision: program.revision } });
  for (const template of data.templates.filter((item: { active?: boolean }) => item.active))
    await request.post(`/api/templates/${template.id}/active`, { headers, data: { active: false, revision: template.revision } });
}

async function startWorkout(request: APIRequestContext, headers: Headers, templateId: string) {
  const started = await request.post('/api/workouts', { headers, data: { templateId } });
  expect(started.ok(), await started.text()).toBeTruthy();
  return started.json();
}

async function finishWorkout(request: APIRequestContext, headers: Headers, templateId: string) {
  const session = await startWorkout(request, headers, templateId);
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

test('an activated program can be edited while its passed days stay locked, and the running day is marked', async ({ page }, info) => {
  await signIn(page, USER);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const open = await (await page.request.get('/api/workouts/active')).json();
  if (open) await page.request.post(`/api/workouts/${open.id}/discard`, { headers });
  const stamp = `${info.project.name} ${Date.now()}`;
  const programName = `Edit program ${stamp}`;
  let programId: string | null = null;
  try {
    const catalog = await (await page.request.get('/api/exercises')).json();
    const bench = catalog.find((exercise: { name: string }) => exercise.name === 'Barbell bench press') ?? catalog[0];
    const exercise = { exerciseId: bench.id, sourceName: bench.name, sets: [{ repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90 }] };
    await vacate(page.request, headers);
    const response = await page.request.post('/api/programs', { headers, data: { name: programName, workouts: [
      { week: 1, name: 'Upper A', exercises: [exercise] },
      { week: 1, name: 'Lower A', exercises: [exercise] },
      { week: 2, name: 'Upper B', exercises: [exercise] },
      { week: 3, name: 'Upper C', exercises: [exercise] }
    ] } });
    expect(response.ok(), await response.text()).toBeTruthy();
    const created = await response.json();
    programId = created.id;
    const dayId = (name: string) => created.workouts.find((day: { name: string }) => day.name === name).id;
    await finishWorkout(page.request, headers, dayId('Upper A'));
    const running = await startWorkout(page.request, headers, dayId('Lower A'));

    // The day that is open is "In progress" and is not also offered as "Next".
    await page.goto('/workouts');
    // An open workout opens its sheet; minimized, the page behind it is the one being checked.
    const minimize = page.getByRole('button', { name: 'Minimize workout' });
    if (await minimize.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) await minimize.click();
    await expect(minimize).toBeHidden();
    const zone = page.locator('[data-slot-zone="active"]');
    const card = zone.locator('.program-card').filter({ hasText: programName });
    const row = (name: string) => card.getByRole('button', { name: `View ${name}`, exact: true });
    await expect(row('Lower A')).toContainText('In progress');
    await expect(row('Lower A')).not.toContainText('Next');
    await expect(card.getByText('Next', { exact: true })).toHaveCount(0);
    await expect(row('Upper A')).toContainText('Done');
    await card.screenshot({ path: join(screenshotsDirectory, `${info.project.name}-program-in-progress.png`) });

    // Once the workout is gone the day is simply next again.
    await page.request.post(`/api/workouts/${running.id}/discard`, { headers });
    await page.reload();
    await expect(row('Lower A')).toContainText('Next');
    await expect(row('Lower A')).not.toContainText('In progress');

    // A day already done opens the workout that completed it; its plan stays read-only in the editor below.
    await row('Upper A').click();
    const review = page.getByRole('dialog', { name: 'Upper A', exact: true });
    await expect(review.getByText('Completed workout', { exact: true })).toBeVisible();
    await review.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(review).toBeHidden();

    // Edit the whole program from the card menu.
    await card.getByRole('button', { name: `Actions for ${programName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit program', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit program', exact: true })).toBeVisible();
    await expect(page.getByText('Weeks and days you have already passed are locked')).toBeVisible();
    const editedName = `${programName} edited`;
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reorder Lower A', exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Reorder Upper A/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete week 1' })).toHaveCount(0);
    await expect(page.locator('.pdl-day-card').filter({ hasText: 'Upper A' }).locator('.pdl-lock-tag')).toHaveText('Done');
    await page.screenshot({ path: join(screenshotsDirectory, `${info.project.name}-program-edit-locked.png`), fullPage: true });

    // The passed day opens for reading only.
    await page.getByRole('button', { name: 'Upper A', exact: true }).click();
    await expect(page.locator('.day-detail-modal .readonly-exercise')).toHaveCount(1);
    await expect(page.locator('.day-detail-modal').getByRole('textbox')).toHaveCount(0);
    await page.locator('.day-detail-modal').getByRole('button', { name: 'Close dialog', exact: true }).click();

    // Rename the program and add a copy of week one after it: both are allowed.
    await page.getByLabel('Program name').fill(editedName);
    await page.getByRole('button', { name: 'Add week' }).click();
    await page.getByRole('button', { name: /^Duplicate Week 1/ }).click();
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();

    const saved = await (await page.request.get(`/api/programs/${programId}`)).json();
    expect(saved.name).toBe(editedName);
    expect(saved.weeks).toBe(4);
    expect(saved.workouts).toHaveLength(6);
    expect(saved.completedTemplateIds).toContain(dayId('Upper A'));
    expect(saved.progress.currentWeek).toBe(1);
    expect(saved.workouts.find((day: { id: string }) => day.id === dayId('Upper A')).revision)
      .toBe(created.workouts.find((day: { id: string }) => day.id === dayId('Upper A')).revision);

    // The past stays protected even when the request does not come from the editor.
    const refused = await page.request.put(`/api/programs/${programId}/plan`, { headers, data: {
      name: editedName, revision: saved.revision, idempotencyId: crypto.randomUUID(),
      days: saved.workouts.filter((day: { id: string }) => day.id !== dayId('Upper A')).map((day: Record<string, unknown>) => ({
        id: day.id, week: day.week, name: day.name, focus: day.focus, note: day.note, block: day.block, phase: day.phase,
        phaseWeek: day.phaseWeek, isRestDay: day.isRestDay, sourcePage: day.sourcePage,
        exercises: (day.exercises as Record<string, unknown>[]).map(item => ({
          exerciseId: item.exerciseId, sourceName: item.sourceName, note: item.note, sets: item.sets, sequenceGroup: item.sequenceGroup,
          substitutions: item.substitutions, sourcePage: item.sourcePage, slotKey: item.slotKey, restSeconds: item.restSeconds
        }))
      }))
    } });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error ?? (await refused.text())).toContain('already past');

    // Out of the slot nothing is locked any more.
    await page.reload();
    const savedCard = zone.locator('.program-card').filter({ hasText: editedName });
    await expect(savedCard).toBeVisible();
    await savedCard.getByRole('button', { name: `Actions for ${editedName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to library', exact: true }).click();
    await page.getByRole('dialog', { name: `Move ${editedName} to the library?` }).getByRole('button', { name: 'Move and forget progress', exact: true }).click();
    const library = page.locator('[data-slot-zone="library"]');
    const libraryCard = library.locator('.library-program-card').filter({ hasText: editedName });
    await expect(libraryCard).toBeVisible();
    await libraryCard.getByRole('button', { name: `Actions for ${editedName}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Edit program', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit program', exact: true })).toBeVisible();
    await expect(page.getByText('Weeks and days you have already passed are locked')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reorder Upper A', exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Back to workouts' }).click();
    await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  } finally {
    const active = await (await page.request.get('/api/workouts/active')).json().catch(() => null);
    if (active) await page.request.post(`/api/workouts/${active.id}/discard`, { headers }).catch(() => {});
    if (programId) await page.request.delete(`/api/programs/${programId}`, { headers }).catch(() => {});
  }
});
