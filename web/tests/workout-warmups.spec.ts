import { expect, test, type Locator } from '@playwright/test';
import { signIn } from './signIn';

const weights = (workout: Locator, name: string) =>
  workout.getByRole('spinbutton', { name: new RegExp(`^${name} set \\d+ weight$`) });

// A first-time lift starts with empty loads: typing the first working weight fills the empty sets
// after it, and the warm-up button builds a ramp from it, saved with the workout like any set.
test('working loads fill the empty sets after them and warm-ups ramp up to them', async ({ page }, info) => {
  await signIn(page);
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const initial = await (await page.request.get('/api/bootstrap')).json();
  if (initial.activeWorkout?.active) await page.request.post(`/api/workouts/${initial.activeWorkout.id}/discard`, { headers });
  // Deleting a custom exercise archives it, so each run needs names of its own.
  const tag = `${info.project.name} ${Date.now().toString(36)}`;
  const created: string[] = [];
  let templateId: string | null = null;
  let sessionId: string | null = null;
  try {
    const custom = async (name: string, muscle: string) => {
      const response = await page.request.post('/api/exercises/custom', { headers, data: {
        name, muscle, equipment: 'Barbell', loadModel: 'external', weightBasis: 'total' } });
      expect(response.ok(), await response.text()).toBeTruthy();
      const exercise = await response.json();
      created.push(exercise.id);
      return exercise;
    };
    const squat = await custom(`Ramp squat ${tag}`, 'Quads');
    const press = await custom(`Ramp press ${tag}`, 'Shoulders');
    const working = { repMin: 5, repMax: 5, targetRpe: 8, restSeconds: 120, warmup: false };
    const template = await page.request.post('/api/templates', { headers, data: {
      name: `Ramp day ${tag}`, focus: 'Strength', exercises: [
        { exerciseId: squat.id, sourceName: squat.name, sets: [working, working, working] },
        { exerciseId: press.id, sourceName: press.name, sets: [{ ...working, warmup: true, repMin: null, repMax: null }, working, working] }
      ] } });
    expect(template.ok(), await template.text()).toBeTruthy();
    templateId = (await template.json()).id;
    const started = await page.request.post('/api/workouts', { headers, data: { templateId } });
    expect(started.ok(), await started.text()).toBeTruthy();
    sessionId = (await started.json()).id;

    await page.goto('/');
    const workout = page.getByRole('dialog', { name: `Ramp day ${tag}`, exact: true });
    await expect(workout).toBeVisible();
    const addWarmups = workout.getByRole('button', { name: 'Add warm-ups', exact: true });
    await expect(workout.getByText('Enter the first working weight to plan warm-ups.', { exact: true })).toBeHidden();
    await addWarmups.click();
    await expect(workout.getByText('Enter the first working weight to plan warm-ups.', { exact: true })).toBeVisible();

    await workout.getByRole('spinbutton', { name: `${squat.name} set 1 weight`, exact: true }).fill('100');
    await expect(workout.getByText('Enter the first working weight to plan warm-ups.', { exact: true })).toBeHidden();
    await expect(weights(workout, squat.name)).toHaveCount(3);
    for (const field of await weights(workout, squat.name).all()) await expect(field).toHaveValue('100');

    // 100 kg on a barbell with no bodyweight on record: the empty bar, then 50, 70 and 85 kg.
    await addWarmups.click();
    await expect(weights(workout, squat.name)).toHaveCount(7);
    const ramp = await Promise.all((await weights(workout, squat.name).all()).map(field => field.inputValue()));
    expect(ramp).toEqual(['20', '50', '70', '85', '100', '100', '100']);
    await expect(workout.getByRole('button', { name: 'Add warm-ups', exact: true })).toHaveCount(0);
    await workout.screenshot({ path: info.outputPath('warmups-added.png') });

    // The plan gives the press one warm-up; its load calls for more, so the lifter chooses.
    await workout.getByRole('tab', { name: new RegExp(`^${press.name}, `) }).click();
    await workout.getByRole('spinbutton', { name: `${press.name} set 2 weight`, exact: true }).fill('60');
    await workout.getByRole('button', { name: 'Fill warm-ups', exact: true }).click();
    const choice = page.getByRole('dialog', { name: 'Warm-up sets', exact: true });
    await expect(choice.getByText('This plan has 1 warm-up set. For this working weight, 3 are recommended.', { exact: true })).toBeVisible();
    await choice.screenshot({ path: info.outputPath('warmup-choice.png') });
    await choice.getByRole('button', { name: 'Use 3', exact: true }).click();
    await expect(choice).toBeHidden();
    const pressRamp = await Promise.all((await weights(workout, press.name).all()).map(field => field.inputValue()));
    expect(pressRamp).toEqual(['20', '35', '47.5', '60', '60']);

    // The ramp is saved with the workout.
    await expect.poll(async () => {
      const session = await (await page.request.get(`/api/workouts/${sessionId}`)).json();
      return session.exercises.map((exercise: { sets: { warmup: boolean }[] }) => exercise.sets.filter(set => set.warmup).length);
    }, { timeout: 15000 }).toEqual([4, 3]);
  } finally {
    if (sessionId) await page.request.post(`/api/workouts/${sessionId}/discard`, { headers });
    if (templateId) await page.request.delete(`/api/templates/${templateId}`, { headers });
    for (const id of created) await page.request.delete(`/api/exercises/custom/${id}`, { headers });
  }
});
