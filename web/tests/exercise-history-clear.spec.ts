import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

// Clearing an exercise's history is permanent, so it lives at the end of the History tab and every
// press answers in a dialog, including the refusal while a workout is open.
test('clearing exercise history explains an open workout and asks before removing sets', async ({ page }, info) => {
  await signIn(page);
  const catalog = await (await page.request.get('/api/exercises')).json();
  const exercise = catalog.find((row: { slug: string }) => row.slug === 'barbell-bench-press') ?? catalog[0];
  let workoutOpen = true;
  let clears = 0;
  await page.route(`**/api/exercises/${exercise.id}/insight?*`, async route => {
    const insight = await (await route.fetch()).json();
    await route.fulfill({ json: { ...insight, clearableSetCount: 4 } });
  });
  await page.route(`**/api/exercises/${exercise.id}/clear-preview`, route => route.fulfill({ json: {
    exerciseId: exercise.id, name: exercise.name, affectedWorkouts: 2, affectedSets: 4, hasActiveWorkout: workoutOpen, canClear: !workoutOpen
  } }));
  await page.route(`**/api/exercises/${exercise.id}/clear-history`, route => {
    clears++;
    return route.fulfill({ json: { exerciseId: exercise.id, name: exercise.name, affectedWorkouts: 2, affectedSets: 4, hasActiveWorkout: false, canClear: true } });
  });

  await page.goto('/exercises');
  await page.getByRole('textbox', { name: 'Search exercises', exact: true }).fill(exercise.name);
  await page.getByRole('button', { name: `View ${exercise.name} details`, exact: true }).click();
  const details = page.getByRole('dialog', { name: exercise.name, exact: true });
  // Beside Done there is nothing destructive to press by accident.
  await expect(details.getByRole('button', { name: 'Clear history', exact: true })).toHaveCount(0);

  await details.getByRole('button', { name: 'History', exact: true }).click();
  const section = details.getByRole('region', { name: 'Clear history', exact: true });
  await expect(section.getByText(/Removes this exercise's 4 sets/)).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await details.screenshot({ path: info.outputPath('clear-history-section.png') });

  await section.getByRole('button', { name: 'Clear history', exact: true }).click();
  const blocked = page.getByRole('dialog', { name: 'Workout in progress', exact: true });
  await expect(blocked.getByText(/Finish or discard the active workout/)).toBeVisible();
  await blocked.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(blocked).toBeHidden();

  workoutOpen = false;
  await section.getByRole('button', { name: 'Clear history', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Clear exercise history?', exact: true });
  await expect(confirmation.getByText('4 sets', { exact: true })).toBeVisible();
  await expect(confirmation.getByText('2 workouts', { exact: true })).toBeVisible();
  await confirmation.screenshot({ path: info.outputPath('clear-history-confirmation.png') });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(clears).toBe(0);

  await section.getByRole('button', { name: 'Clear history', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Clear history', exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(clears).toBe(1);
});
