import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signIn as auth } from './signIn';

const USER = 'e2e-lifter';

/// A minimal but structurally valid PDF. The API checks the signature and counts page markers;
/// the stand-in provider ignores the content entirely.
const pdf = (pages = 3, marker = '') => Buffer.from(`%PDF-1.7\n${'/Type /Page \n'.repeat(pages)}% ${marker}\n%%EOF`, 'latin1');

const signIn = (page: Page) => auth(page, USER);

/// Each viewport project shares one account, so a workout a previous project left open has to
/// go before this one starts its own.
async function clearActiveWorkout(page: Page) {
  const discarded = await page.evaluate(async () => {
    const headers = { 'X-Workout-Request': '1' };
    const response = await fetch('/api/workouts/active', { headers, cache: 'no-store' });
    const active = response.ok ? await response.json() : null;
    if (!active) return false;
    await fetch(`/api/workouts/${active.id}/discard`, { method: 'POST', headers });
    return true;
  });
  if (discarded) await page.reload();
  await expect(page.getByRole('button', { name: /^Resume / })).toBeHidden();
}

/// Reads the active workout straight from the server, which is the only place it exists.
const doneSetsOnServer = (page: Page) => page.evaluate(async () => {
  const response = await fetch('/api/workouts/active', { headers: { 'X-Workout-Request': '1' }, cache: 'no-store' });
  if (!response.ok) return -1;
  const active = await response.json();
  return active ? active.exercises.flatMap((e: { sets: { done: boolean }[] }) => e.sets).filter((s: { done: boolean }) => s.done).length : 0;
});

/// The rest clock reads "1:24 rest"; this is the number behind it.
async function restSeconds(clock: import('@playwright/test').Locator): Promise<number> {
  const text = (await clock.textContent()) ?? '';
  const match = /(\d+):(\d{2})/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

async function openTab(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click();
}

test.describe.configure({ mode: 'serial' });

test('build a workout, log a set against the server, and see it in history', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await signIn(page);
  await clearActiveWorkout(page);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-overview.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await openTab(page, 'Workouts');
  await page.getByRole('button', { name: 'New workout', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: 'Build a workout' });
  const name = `E2E day ${Date.now()}`;
  await editor.getByLabel('Workout name').fill(name);
  await editor.getByRole('button', { name: 'Add exercise', exact: true }).click();
  await editor.getByRole('button', { name: 'Add Barbell bench press', exact: true }).click();
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

  // Other projects leave their own workouts behind, so start the one this test just built.
  await page.locator('.routine-card').filter({ hasText: name }).getByRole('button', { name: 'Start workout', exact: true }).click();

  // The plan is previewed first; nothing is created until it is confirmed.
  const preview = page.getByRole('dialog', { name: `Start ${name}?`, exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.getByText('Barbell bench press', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(preview).toBeHidden();
  expect(await doneSetsOnServer(page)).toBe(0);

  await page.locator('.routine-card').filter({ hasText: name }).getByRole('button', { name: 'Start workout', exact: true }).click();
  await page.getByRole('dialog', { name: `Start ${name}?`, exact: true }).getByRole('button', { name: 'Start workout', exact: true }).click();
  const logger = page.getByRole('dialog', { name, exact: true });
  await expect(logger).toBeVisible();

  const logButton = page.getByRole('button', { name: 'Log Barbell bench press set 1', exact: true });
  await logButton.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const logHit = await logButton.evaluate(el => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { ok: box.width >= 44 && box.height >= 44 && (hit === el || el.contains(hit)), viewport: { innerWidth, innerHeight, visualWidth: visualViewport?.width, visualHeight: visualViewport?.height, scrollY }, box: { x: box.x, y: box.y, width: box.width, height: box.height }, hit: hit && { tag: hit.tagName, cls: String(hit.className), text: hit.textContent?.slice(0, 80) }, parents: [...el.parentElement?.parentElement?.children ?? []].map(node => { const b = (node as HTMLElement).getBoundingClientRect(); return { tag: node.tagName, cls: String(node.className), x: b.x, y: b.y, width: b.width, height: b.height }; }) };
  });
  expect(logHit.ok).toBe(true);

  // Suggested reps are available immediately; load and actual RPE may remain blank until recorded.
  await logButton.click();

  await logger.getByRole('spinbutton', { name: 'Barbell bench press set 1 weight', exact: true }).fill('60');
  await logger.getByRole('spinbutton', { name: 'Barbell bench press set 1 reps', exact: true }).fill('8');
  await logger.getByRole('combobox', { name: 'Barbell bench press set 1 RPE', exact: true }).selectOption('8');
  await logButton.click();
  const logged = page.getByRole('button', { name: 'Unlog Barbell bench press set 1', exact: true });
  await expect(logged).toHaveAttribute('aria-pressed', 'true');
  // A completed set has to read as finished, not just change a label.
  await expect(logger.locator('.set-row.done')).toHaveCount(1);
  await expect(logged).toHaveClass(/primary/);
  // The button transitions into its filled state, so poll for the settled colour.
  await expect.poll(() => logged.evaluate(el => getComputedStyle(el).backgroundColor), { timeout: 5000 }).toBe('rgb(230, 180, 80)');
  // The logged set has to reach the server: nothing is kept on the device to fall back on.
  await expect.poll(() => doneSetsOnServer(page), { timeout: 20000 }).toBe(1);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-logger.png`, fullPage: true });
  expect(await logger.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);

  // Logging a set starts the rest, and the clock counts down rather than sitting still.
  const clock = logger.locator('.rest-clock');
  await expect(clock).toContainText('rest');
  const started = await restSeconds(clock);
  expect(started).toBeGreaterThan(60);
  await expect.poll(() => restSeconds(clock), { timeout: 8000 }).toBeLessThan(started);

  // The set came back from the server, not from this device: a reload proves it.
  await page.reload();
  await page.getByRole('button', { name: `Resume ${name}`, exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Barbell bench press set 1 weight', exact: true })).toHaveValue('60');

  // The rest is a deadline, not a count held in memory, so a reload finds it already lower
  // rather than restarting it or losing it.
  const resumed = await restSeconds(page.locator('.rest-clock'));
  expect(resumed).toBeLessThan(started);
  expect(resumed).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(page.getByText('Workout complete', { exact: true })).toBeVisible();
  await expect(page.getByText('60 kg × 8', { exact: true })).toBeVisible();
  await expect(page.getByText('RPE 8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await openTab(page, 'Progress');
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

  // Starting the same plan again has to carry the last session forward: 8 reps at RPE 8 against
  // a target of 8-12 leaves effort in the tank, so the app asks for one more rep at the same
  // load and says so in words rather than silently changing a number.
  await openTab(page, 'Workouts');
  await page.locator('.routine-card').filter({ hasText: name }).getByRole('button', { name: 'Start workout', exact: true }).click();
  await page.getByRole('dialog', { name: `Start ${name}?`, exact: true }).getByRole('button', { name: 'Start workout', exact: true }).click();
  const again = page.getByRole('dialog', { name, exact: true });
  await expect(again.locator('.progression-note')).toContainText('one more rep');
  await expect(again.getByRole('spinbutton', { name: 'Barbell bench press set 1 weight', exact: true })).toHaveValue('60');
  await expect(again.getByRole('spinbutton', { name: 'Barbell bench press set 1 reps', exact: true })).toHaveValue('9');
  await again.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Discard workout', exact: true }).click();
  await expect(again).toBeHidden();

  expect(errors).toEqual([]);
});

test('import a PDF program, preserve an unmapped exercise, and accept it', async ({ page }, testInfo) => {
  await signIn(page);
  await openTab(page, 'Workouts');
  await page.getByRole('button', { name: 'Import a PDF program', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import a program' })).toBeVisible();

  await page.getByLabel('Program PDF').setInputFiles({ name: 'block.pdf', mimeType: 'application/pdf', buffer: pdf(3, testInfo.project.name) });
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 60000 });
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-import-review.png`, fullPage: true });

  // Every value carries where it came from, and the rep range from the PDF is preserved.
  await page.getByRole('button', { name: /W1 · Week 1 Upper/ }).click();
  await expect(page.getByText('From the PDF').first()).toBeVisible();
  await expect(page.getByText('AI suggestion').first()).toBeVisible();
  await expect(page.getByLabel('Set 1 reps text').first()).toHaveValue('8–10');

  // The name the model could not match stays verbatim and does not block acceptance.
  await expect(page.getByText(/Unmapped · preserved/).first()).toBeVisible();
  const accept = page.getByRole('button', { name: 'Accept and create program', exact: true });
  await expect(accept).toBeEnabled({ timeout: 30000 });

  // Rename the draft so each viewport's accepted program is its own, and to prove the edit sticks.
  const programName = `Imported block ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel('Program name').fill(programName);
  await page.getByLabel('Program name').blur();
  await expect.poll(async () => page.evaluate(async () => {
    const response = await fetch('/api/imports', { headers: { 'X-Workout-Request': '1' }, cache: 'no-store' });
    const rows = await response.json();
    const row = rows.find((item: { status: string }) => item.status === 'ready');
    if (!row) return '';
    const full = await fetch(`/api/imports/${(row as { id: string }).id}`, { headers: { 'X-Workout-Request': '1' }, cache: 'no-store' });
    return (await full.json()).draft?.programName ?? '';
  }), { timeout: 20000 }).toBe(programName);

  await accept.click();
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: programName })).toBeVisible();
  const programCard = page.locator('.program-card').filter({ hasText: programName });
  await programCard.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(page.getByText('Week 1 Upper', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Week 2 Upper', { exact: true }).first()).toBeVisible();
  expect(await programCard.locator('.routine-row-static').evaluateAll(rows => rows.every(row => row.tagName !== 'BUTTON'))).toBe(true);
});

test('a discarded draft leaves no program behind', async ({ page }) => {
  await signIn(page);
  await openTab(page, 'Workouts');
  await page.getByRole('button', { name: 'Import a PDF program', exact: true }).click();
  await page.getByLabel('Program PDF').setInputFiles({ name: 'throwaway.pdf', mimeType: 'application/pdf', buffer: pdf(5) });
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 60000 });

  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review' })).toBeHidden({ timeout: 30000 });
});

test('offline and server failures are reported instead of faked', async ({ page, context }) => {
  await signIn(page);
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).active))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  // The shell still loads from the precache, but it must not pretend to have training data.
  await expect(page.getByRole('heading', { name: /Could not reach the server|Loading your training/ })).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);

  await context.setOffline(false);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 30000 });
});

test('the API is never answered from the app shell and requires a session', async ({ page, request }) => {
  const bootstrap = await request.get('/api/bootstrap', { headers: { Cookie: '' } });
  expect([401, 403]).toContain(bootstrap.status());
  expect(bootstrap.headers()['content-type'] ?? '').not.toContain('text/html');

  const missingAsset = await request.get('/assets/not-a-real-file.js');
  expect(missingAsset.status()).toBe(404);

  await signIn(page);
  const exported = await page.evaluate(async () => {
    const response = await fetch('/api/export', { headers: { 'X-Workout-Request': '1' } });
    return { status: response.status, cache: response.headers.get('cache-control') };
  });
  expect(exported.status).toBe(200);
  expect(exported.cache).toContain('no-store');
});
