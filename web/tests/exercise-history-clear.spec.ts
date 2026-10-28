import { expect, test } from '@playwright/test';
import { signIn } from './signIn';

// Clearing an exercise's history is permanent, so it lives at the end of the History tab and every
// press answers in a dialog. An open workout that includes the exercise reads its history, so the
// section names it up front, and a workout opened between the check and the confirmation is caught.
test('clearing exercise history waits for an open workout that uses it and asks before removing sets', async ({ page }, info) => {
  await signIn(page);
  const catalog = await (await page.request.get('/api/exercises')).json();
  const exercise = catalog.find((row: { slug: string }) => row.slug === 'barbell-bench-press') ?? catalog[0];
  let workoutOpen = true;
  let clears = 0;
  const preview = () => ({ exerciseId: exercise.id, name: exercise.name, affectedWorkouts: 2, affectedSets: 4,
    hasActiveWorkout: workoutOpen, canClear: !workoutOpen, activeWorkoutName: workoutOpen ? 'Push B' : null });
  await page.route(`**/api/exercises/${exercise.id}/insight?*`, async route => {
    const insight = await (await route.fetch()).json();
    await route.fulfill({ json: { ...insight, clearableSetCount: 4 } });
  });
  await page.route(`**/api/exercises/${exercise.id}/clear-preview`, route => route.fulfill({ json: preview() }));
  await page.route(`**/api/exercises/${exercise.id}/clear-history`, route => {
    if (workoutOpen) return route.fulfill({ status: 409, json: { error: 'Finish or discard “Push B” first.' } });
    clears++;
    return route.fulfill({ json: preview() });
  });

  await page.goto('/exercises');
  await page.getByRole('textbox', { name: 'Search exercises', exact: true }).fill(exercise.name);
  await page.getByRole('button', { name: `View ${exercise.name} details`, exact: true }).click();
  const details = page.getByRole('dialog', { name: exercise.name, exact: true });
  // Beside Done there is nothing destructive to press by accident.
  await expect(details.getByRole('button', { name: 'Clear history', exact: true })).toHaveCount(0);

  await details.getByRole('button', { name: 'History', exact: true }).click();
  const section = details.getByRole('region', { name: 'Clear history', exact: true });
  // The open workout is named, and no press that cannot succeed is offered.
  await expect(section.getByText(/“Push B” includes this exercise and uses its history/)).toBeVisible();
  await expect(section.getByRole('button', { name: 'Clear history', exact: true })).toHaveCount(0);
  await section.scrollIntoViewIfNeeded();
  await details.screenshot({ path: info.outputPath('clear-history-blocked.png') });

  workoutOpen = false;
  await section.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(section.getByText(/Removes this exercise's 4 sets/)).toBeVisible();
  await details.screenshot({ path: info.outputPath('clear-history-section.png') });
  await section.getByRole('button', { name: 'Clear history', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Clear exercise history?', exact: true });
  await expect(confirmation.getByText('4 sets', { exact: true })).toBeVisible();
  await expect(confirmation.getByText('2 workouts', { exact: true })).toBeVisible();
  await confirmation.screenshot({ path: info.outputPath('clear-history-confirmation.png') });
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(clears).toBe(0);

  // A workout with this exercise opens elsewhere while the confirmation is up.
  await section.getByRole('button', { name: 'Clear history', exact: true }).click();
  workoutOpen = true;
  await confirmation.getByRole('button', { name: 'Clear history', exact: true }).click();
  const blocked = page.getByRole('dialog', { name: 'Workout in progress', exact: true });
  await expect(blocked.getByText(/“Push B” includes this exercise/)).toBeVisible();
  await blocked.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(blocked).toBeHidden();
  await expect(section.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  expect(clears).toBe(0);

  workoutOpen = false;
  await section.getByRole('button', { name: 'Check again', exact: true }).click();
  await section.getByRole('button', { name: 'Clear history', exact: true }).click();
  // A clear re-reads the exercise's insight through the route above; the test must not end while
  // that read is still in flight, or its response is disposed under the handler.
  const refreshed = page.waitForResponse(response => response.url().includes(`/api/exercises/${exercise.id}/insight`));
  await confirmation.getByRole('button', { name: 'Clear history', exact: true }).click();
  await expect(confirmation).toBeHidden();
  expect(clears).toBe(1);
  await refreshed;
});
