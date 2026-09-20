import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signIn as auth } from './signIn';
import { pdf } from './pdfFixture';

const USER = 'e2e-lifter';


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
  await page.locator('.motion-scene').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished))).catch(() => {});
}

async function openStartPreview(page: Page, startButton: import('@playwright/test').Locator, preview: import('@playwright/test').Locator) {
  const templateResponse = page.waitForResponse(response => response.request().method() === 'GET' && /\/api\/templates\/[0-9a-f-]+$/i.test(new URL(response.url()).pathname), { timeout: 15000 }).catch(() => null);
  await startButton.click({ force: true });
  const response = await templateResponse;
  if (response) expect(response.ok()).toBe(true);
  await expect(preview).toBeVisible({ timeout: 15000 });
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
  const builderPicker = page.getByRole('dialog', { name: 'Add exercise to workout', exact: true });
  await builderPicker.getByRole('button', { name: 'Add Barbell bench press', exact: true }).click();
  await expect(builderPicker).toBeHidden();
  await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();

  // Other projects leave their own workouts behind, so start the one this test just built.
  const preview = page.getByRole('dialog', { name: `Start ${name}?`, exact: true });
  const startBtn = page.locator('.routine-card').filter({ hasText: name }).getByRole('button', { name: 'Start workout', exact: true });
  await startBtn.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await openStartPreview(page, startBtn, preview);

  // The plan is previewed first; nothing is created until it is confirmed.
  await expect(preview.getByText('Barbell bench press', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(preview).toBeHidden();
  expect(await doneSetsOnServer(page)).toBe(0);

  await openStartPreview(page, startBtn, preview);
  await preview.getByRole('button', { name: 'Start workout', exact: true }).click();
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
  await logger.getByRole('button', { name: 'Barbell bench press set 1 RPE', exact: true }).click();
  await logger.getByRole('listbox', { name: 'Barbell bench press set 1 RPE', exact: true })
    .getByRole('option', { name: '8', exact: true }).click();
  await logButton.click();
  const logged = page.getByRole('button', { name: 'Unlog Barbell bench press set 1', exact: true });
  await expect(logged).toHaveAttribute('aria-pressed', 'true');
  // A completed set has to read as finished, not just change a label.
  await expect(logger.locator('.workout-set-row.done')).toHaveCount(1);
  await expect(logged).toHaveClass(/checked/);
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
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Resume / })).toBeHidden();
  const againCard = page.locator('.routine-card').filter({ hasText: name });
  const againStartBtn = againCard.getByRole('button', { name: 'Start workout', exact: true });
  await againStartBtn.evaluate(el => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    return Promise.all(document.getAnimations().map(a => a.finished));
  });
  const againPreview = page.getByRole('dialog', { name: `Start ${name}?`, exact: true });
  await openStartPreview(page, againStartBtn, againPreview);
  await againPreview.getByRole('button', { name: 'Start workout', exact: true }).click();
  const again = page.getByRole('dialog', { name, exact: true });
  await expect(again.locator('.suggestion-text').first()).toBeVisible();
  await expect(again.getByRole('spinbutton', { name: 'Barbell bench press set 1 weight', exact: true })).toHaveValue('60');
  await expect(again.getByRole('spinbutton', { name: 'Barbell bench press set 1 reps', exact: true })).toHaveValue('9');
  await again.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Discard workout', exact: true }).click();
  await expect(again).toBeHidden();

  expect(errors).toEqual([]);
});

test('import a PDF program, resolve an unmapped exercise, and accept it', async ({ page }, testInfo) => {
  await signIn(page);
  await openTab(page, 'Workouts');
  await page.getByRole('button', { name: 'Import a PDF program', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import a program' })).toBeVisible();

  // The document itself must never leave the browser: what reaches the API is the page text this
  // device read out of it.
  const posted: string[] = [];
  await page.route('**/api/imports', async route => {
    if (route.request().method() === 'POST') posted.push(route.request().headers()['content-encoding'] ?? '');
    await route.continue();
  });

  await page.getByLabel('Program PDF').setInputFiles({ name: 'block.pdf', mimeType: 'application/pdf', buffer: pdf(4, testInfo.project.name) });
  await expect.poll(() => posted, { timeout: 60000 }).toEqual(['gzip']);
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Description', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-import-review.png`, fullPage: true });

  // The day reads as what it prescribes before it is opened.
  const day = page.getByRole('button', { name: 'Week 1 Upper', exact: true });
  await expect(day).toBeVisible();
  const issue = page.getByRole('button', { name: 'Fix unmapped exercise Mystery machine row', exact: true });
  await issue.click();
  await expect(page.getByRole('button', { name: 'Library exercise for Mystery machine row', exact: true })).toBeFocused();

  // Opening it is for editing, and the rep range from the PDF is preserved as explicit bounds.
  await expect(page.getByLabel('Min reps').first()).toHaveValue('8');
  await expect(page.getByLabel('Max reps').first()).toHaveValue('10');

  if (testInfo.project.name === 'mobile') {
    const swipeRow = page.locator('.swipeable-row-mobile.import-set-swipe-row').first();
    const surface = swipeRow.locator('.swipeable-row-surface');
    await surface.scrollIntoViewIfNeeded();
    await surface.evaluate(element => {
      const box = element.getBoundingClientRect();
      const init = (type: string, clientX: number) => element.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 17, pointerType: 'touch', isPrimary: true,
        buttons: type === 'pointerup' ? 0 : 1, clientX, clientY: box.top + box.height / 2
      }));
      init('pointerdown', box.right - 12);
      init('pointermove', box.left + 12);
      init('pointerup', box.left + 12);
    });
    await expect(surface).toHaveAttribute('data-swipe-open', 'true');
    await surface.click();
    await expect(surface).toHaveAttribute('data-swipe-open', 'false');
  } else {
    await expect(page.locator('.swipeable-row-desktop-actions .import-set-remove').first()).toBeVisible();
  }

  // Review maps one exercise at a time through the searchable picker; the removed bulk rematch
  // action must not return as a hidden or alternate path.
  await expect(page.getByRole('button', { name: 'Match against the library again', exact: true })).toHaveCount(0);
  const mapping = page.getByRole('button', { name: 'Library exercise for Mystery machine row', exact: true });
  await mapping.click();
  const picker = page.getByRole('dialog', { name: 'Choose a library exercise for Mystery machine row', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('textbox', { name: 'Search exercises', exact: true }).fill('bench press');
  await expect(picker.getByRole('button', { name: 'Map Barbell bench press', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Done', exact: true }).click();

  // An unresolved mapping keeps the server-authoritative create action disabled.
  const accept = page.getByRole('button', { name: 'Accept and create program', exact: true });
  await expect(accept).toBeDisabled();
  await mapping.click();
  await expect(picker).toBeVisible();
  await picker.getByRole('textbox', { name: 'Search exercises', exact: true }).fill('bench press');
  await picker.getByRole('button', { name: 'Map Barbell bench press', exact: true }).click();
  await expect(accept).toBeEnabled({ timeout: 30000 });

  // Hold a normal draft save while substituting a mapped exercise. The substitution must be
  // serialized behind that save and stay selected after the older response arrives.
  let signalFirstDraftWrite!: () => void;
  const firstDraftWrite = new Promise<void>(resolve => { signalFirstDraftWrite = resolve; });
  let delayedFirstDraftWrite = false;
  await page.route('**/api/imports/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!delayedFirstDraftWrite && route.request().method() === 'PUT' && /^\/api\/imports\/[^/]+$/.test(pathname)) {
      delayedFirstDraftWrite = true;
      signalFirstDraftWrite();
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    await route.continue();
  });

  const programName = `Imported block ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel('Program name').fill(programName);
  await page.getByLabel('Program name').blur();
  await firstDraftWrite;
  const restoreDraft = page.getByRole('button', { name: 'Restore default draft', exact: true });
  await expect(restoreDraft).toBeVisible();
  await expect(restoreDraft).toBeEnabled();

  const substitutionCard = page.locator('.import-exercise').filter({
    has: page.locator('.substitution-chip').filter({ hasText: 'DB Incline Press' })
  }).first();
  const substitutionLineId = await substitutionCard.getAttribute('data-import-exercise');
  expect(substitutionLineId).toBeTruthy();
  const substitutedExercise = page.locator(`[data-import-exercise="${substitutionLineId}"]`);
  await substitutionCard.locator('.substitution-chip').filter({ hasText: 'DB Incline Press' }).click();
  await expect(substitutedExercise.getByRole('textbox', { name: 'Exercise name' })).toHaveValue('DB Incline Press');
  await page.waitForTimeout(2000);
  await expect(substitutedExercise.getByRole('textbox', { name: 'Exercise name' })).toHaveValue('DB Incline Press');
  await expect.poll(async () => page.evaluate(async () => {
    const response = await fetch('/api/imports', { headers: { 'X-Workout-Request': '1' }, cache: 'no-store' });
    const rows = await response.json();
    const row = rows.find((item: { status: string }) => item.status === 'ready');
    if (!row) return '';
    const full = await fetch(`/api/imports/${(row as { id: string }).id}`, { headers: { 'X-Workout-Request': '1' }, cache: 'no-store' });
    return (await full.json()).draft?.programName ?? '';
  }), { timeout: 20000 }).toBe(programName);
  await expect.poll(async () => page.evaluate(async lineId => {
    const response = await fetch('/api/imports', { headers: { 'X-Workout-Request': '1' }, cache: 'no-store' });
    const rows = await response.json();
    const row = rows.find((item: { status: string }) => item.status === 'ready');
    if (!row) return '';
    const full = await fetch(`/api/imports/${row.id}`, { headers: { 'X-Workout-Request': '1' }, cache: 'no-store' });
    const view = await full.json();
    return view.draft?.workouts.flatMap((day: { exercises: { lineId: string; sourceName: string }[] }) => day.exercises)
      .find((exercise: { lineId: string }) => exercise.lineId === lineId)?.sourceName ?? '';
  }, substitutionLineId), { timeout: 20000 }).toBe('DB Incline Press');

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
  await page.getByLabel('Program PDF').setInputFiles({ name: 'throwaway.pdf', mimeType: 'application/pdf', buffer: pdf(5, 'throwaway') });
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
  const responseCheck = await page.evaluate(async () => {
    const response = await fetch('/api/history', { headers: { 'X-Workout-Request': '1' } });
    return { status: response.status, cache: response.headers.get('cache-control') };
  });
  expect(responseCheck.status).toBe(200);
  expect(responseCheck.cache).toContain('no-store');
});

test('overview calendar displays matching markers and details for completed, in-progress, and empty days', async ({ page }) => {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const todayStr = toDateStr(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);

  const startOfWeek = new Date(today);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
  const currentWeekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });
  const emptyDay = currentWeekDays.find(d => toDateStr(d) !== todayStr && toDateStr(d) !== yesterdayStr)!;

  const mockActivity = [
    {
      id: 'activity-completed-today',
      name: 'Evening Bench & Arms',
      startedAt: `${yesterdayStr}T23:30:00.000Z`,
      finishedAt: `${todayStr}T00:30:00.000Z`,
      status: 'completed',
      date: todayStr,
    },
    {
      id: 'activity-in-progress-yesterday',
      name: 'Late Night Squats',
      startedAt: `${yesterdayStr}T23:30:00.000Z`,
      finishedAt: null,
      status: 'in_progress',
      date: yesterdayStr,
    },
  ];

  await page.route('**/api/workouts/activity*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockActivity),
    });
  });

  await page.route('**/api/bootstrap', async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.history = json.history || { sessions: [] };
    json.history.sessions = [
      {
        id: 'activity-completed-today',
        name: 'Evening Bench & Arms',
        startedAt: `${yesterdayStr}T23:30:00.000Z`,
        finishedAt: `${todayStr}T00:30:00.000Z`,
        exercises: [],
        notes: '',
        unit: 'kg',
        durationMinutes: 60,
        volumeKg: 1000,
        totalReps: 50,
      },
      ...(json.history.sessions || []),
    ];
    await route.fulfill({ response, json });
  });

  await signIn(page);

  const todayButton = page.getByRole('button', { name: new RegExp(`^${today.toDateString()}, workout completed, today$`) });
  await expect(todayButton).toBeVisible();
  await expect(todayButton).toHaveClass(/day-completed/);
  await expect(todayButton).toHaveClass(/today/);
  await expect(todayButton.locator('svg')).toBeVisible();

  await todayButton.click();
  const todayTitle = today.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
  const todayModal = page.getByRole('dialog', { name: todayTitle, exact: true });
  await expect(todayModal).toBeVisible();
  await expect(todayModal.getByText('Evening Bench & Arms', { exact: true })).toBeVisible();
  await expect(todayModal.getByText('completed', { exact: true })).toBeVisible();
  await todayModal.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(todayModal).toBeHidden();

  if (today.getDay() === 1) {
    await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  }

  const yesterdayButton = page.getByRole('button', { name: new RegExp(`^${yesterday.toDateString()}, workout in progress$`) });
  await expect(yesterdayButton).toBeVisible();
  await expect(yesterdayButton).toHaveClass(/day-in_progress/);
  expect(await yesterdayButton.evaluate(el => el.classList.contains('day-completed'))).toBe(false);
  await expect(yesterdayButton.locator('.day-marker')).toHaveText('…');

  await yesterdayButton.click();
  const yesterdayTitle = yesterday.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
  const yesterdayModal = page.getByRole('dialog', { name: yesterdayTitle, exact: true });
  await expect(yesterdayModal).toBeVisible();
  await expect(yesterdayModal.getByText('Late Night Squats', { exact: true })).toBeVisible();
  await expect(yesterdayModal.getByText('in progress', { exact: true })).toBeVisible();
  await expect(yesterdayModal.getByText('Evening Bench & Arms', { exact: true })).toBeHidden();
  await yesterdayModal.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(yesterdayModal).toBeHidden();

  if (today.getDay() === 1) {
    await page.getByRole('button', { name: 'Return to this week', exact: true }).click();
  }

  const emptyDayButton = page.getByRole('button', { name: new RegExp(`^${emptyDay.toDateString()}, no workout recorded$`) });
  await expect(emptyDayButton).toBeVisible();
  await expect(emptyDayButton).toHaveClass(/day-rest/);
  await expect(emptyDayButton.locator('.day-marker')).toHaveText('·');

  await emptyDayButton.click();
  const emptyDayTitle = emptyDay.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
  const emptyModal = page.getByRole('dialog', { name: emptyDayTitle, exact: true });
  await expect(emptyModal).toBeVisible();
  await expect(emptyModal.getByText('No workout recorded for this day.', { exact: true })).toBeVisible();
  await emptyModal.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(emptyModal).toBeHidden();
});
