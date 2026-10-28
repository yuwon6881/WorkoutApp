import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { signIn } from './signIn';

test.use({ actionTimeout: 10000 });

// Real touch input through the Chrome DevTools protocol, as in touch.spec.ts: the swipe-to-delete
// tray, the dismissable Undo bar and the rest-time choice are exercised the way a thumb uses them.
async function drag(page: Page, cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= steps; step += 1) {
    const point = { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
    await page.waitForTimeout(10);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('a set swipes open once, deletes on one tap, and its Undo bar swipes away', async ({ page }, info) => {
  await signIn(page, 'e2e-lifter');
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const active = await (await page.request.get('/api/workouts/active')).json();
  if (active) await page.request.post(`/api/workouts/${active.id}/discard`, { headers, timeout: 15000 });
  const catalog = await (await page.request.get('/api/exercises')).json();
  const bench = catalog.find((exercise: { name: string }) => exercise.name === 'Barbell bench press') ?? catalog[0];
  const set = { repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 150, restText: '2-3 min' };
  const template = await page.request.post('/api/templates', { headers, timeout: 15000, data: {
    name: `Gestures ${info.project.name} ${Date.now()}`, focus: '', note: '',
    exercises: [{ exerciseId: bench.id, sourceName: bench.name, sets: [set, set, set] }]
  } });
  expect(template.ok(), await template.text()).toBeTruthy();
  const templateId = (await template.json()).id as string;
  let sessionId: string | undefined;
  try {
    const started = await page.request.post('/api/workouts', { headers, timeout: 15000, data: { templateId } });
    expect(started.ok(), await started.text()).toBeTruthy();
    const session = await started.json();
    sessionId = session.id;
    await page.goto('/');
    const sheet = page.getByRole('dialog', { name: session.name, exact: true });
    await expect(sheet).toBeVisible();
    const cdp = await page.context().newCDPSession(page);

    // A short, slightly diagonal swipe on the second set opens its tray the first time.
    const row = sheet.locator('.workout-set-swipe').nth(1);
    const box = (await row.boundingBox())!;
    const from = { x: box.x + box.width - 24, y: box.y + box.height / 2 };
    await drag(page, cdp, from, { x: from.x - 56, y: from.y + 10 });
    const remove = sheet.getByRole('button', { name: `Remove ${bench.name} set 2`, exact: true });
    await expect(remove).toBeVisible();
    await expect(row.locator('.swipeable-row-surface')).toHaveAttribute('data-swipe-open', 'true');

    // A thumb needs a moment to lift and press again; the tray has settled by then.
    await page.waitForTimeout(350);
    // One tap removes it, and the Undo bar takes its place.
    const target = (await remove.boundingBox())!;
    await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
    const removed = sheet.getByText('Set 2 removed.');
    await expect(removed).toBeVisible();

    // Swiping the bar sideways dismisses it without waiting for the timer.
    const bar = sheet.locator('.workout-set-removed').first();
    const barBox = (await bar.boundingBox())!;
    const start = { x: barBox.x + 24, y: barBox.y + barBox.height / 2 };
    await drag(page, cdp, start, { x: start.x + 160, y: start.y });
    await expect(removed).toBeHidden({ timeout: 2000 });
    // The removal is saved in the background; let it land before the workout is discarded.
    await expect.poll(async () => (await (await page.request.get('/api/workouts/' + session.id)).json()).exercises[0].prescription.length, { timeout: 15000 }).toBe(2);
  } finally {
    if (sessionId) await page.request.post(`/api/workouts/${sessionId}/discard`, { headers, timeout: 15000 });
    await page.request.delete(`/api/templates/${templateId}`, { headers, timeout: 15000 });
  }
});

test('the workout options choose minimal, balanced or maximal rest for a printed range', async ({ page }, info) => {
  await signIn(page, 'e2e-lifter');
  const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };
  const active = await (await page.request.get('/api/workouts/active')).json();
  if (active) await page.request.post(`/api/workouts/${active.id}/discard`, { headers, timeout: 15000 });
  const catalog = await (await page.request.get('/api/exercises')).json();
  const bench = catalog.find((exercise: { name: string }) => exercise.name === 'Barbell bench press') ?? catalog[0];
  const ranged = { repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 150, restText: '2-3 min' };
  const plain = { repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90 };
  const templates: string[] = [];
  let sessionId: string | undefined;
  try {
    for (const [label, sets] of [['ranged', [ranged, ranged]], ['plain', [plain, plain]]] as const) {
      const created = await page.request.post('/api/templates', { headers, timeout: 15000, data: {
        name: `Rest mode ${label} ${info.project.name} ${Date.now()}`, focus: '', note: '',
        exercises: [{ exerciseId: bench.id, sourceName: bench.name, sets }]
      } });
      expect(created.ok(), await created.text()).toBeTruthy();
      templates.push((await created.json()).id as string);
      if (label === 'plain') break;
      const started = await page.request.post('/api/workouts', { headers, timeout: 15000, data: { templateId: templates[0] } });
      expect(started.ok(), await started.text()).toBeTruthy();
      const session = await started.json();
      sessionId = session.id;
      await page.goto('/');
      const sheet = page.getByRole('dialog', { name: session.name, exact: true });
      await expect(sheet).toBeVisible();

      await sheet.getByRole('button', { name: 'Workout options' }).click();
      const choice = page.getByRole('group', { name: 'Rest time', exact: true });
      await expect(choice.getByRole('button', { name: 'Balanced' })).toHaveAttribute('aria-pressed', 'true');
      await choice.getByRole('button', { name: 'Maximal' }).click();
      await page.locator('.picker-sheet-backdrop').click({ position: { x: 8, y: 8 } });

      await sheet.getByRole('button', { name: `Log ${bench.name} set 1`, exact: true }).click();
      // Maximal rest is the printed 3 minutes; the plan's balanced value would read 2:30.
      await expect(sheet.locator('.rest-clock').first()).toHaveText(/^(3:00|2:5\d)/);
    }
    // A plan with no printed range never shows the choice.
    await page.request.post(`/api/workouts/${sessionId}/discard`, { headers, timeout: 15000 });
    const started = await page.request.post('/api/workouts', { headers, timeout: 15000, data: { templateId: templates[1] } });
    const session = await started.json();
    sessionId = session.id;
    await page.goto('/');
    const sheet = page.getByRole('dialog', { name: session.name, exact: true });
    await sheet.getByRole('button', { name: 'Workout options' }).click();
    await expect(page.getByRole('group', { name: 'Rest time', exact: true })).toHaveCount(0);
  } finally {
    if (sessionId) await page.request.post(`/api/workouts/${sessionId}/discard`, { headers, timeout: 15000 });
    for (const id of templates) await page.request.delete(`/api/templates/${id}`, { headers, timeout: 15000 });
  }
});
