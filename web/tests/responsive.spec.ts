import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { join } from 'node:path';
import { signIn as auth } from './signIn';
import { pdf } from './pdfFixture';
import type { ImportView } from '../src/types';

// Geometry checks use reduced motion so the swipe discovery animation cannot shift controls.
test.use({ reducedMotion: 'reduce' });

const USER = 'e2e-responsive';
const screenshotsDirectory = process.env.WORKOUT_TEST_SCREENSHOTS || 'artifacts';

async function checkLayout(page: Page, label: string) {
  // Comparing against innerWidth is not enough: when content overflows, the mobile layout
  // viewport grows to match it, so an overflowing page still reports scrollWidth === innerWidth.
  // The visual viewport is the width the device actually has.
  const fit = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    visualWidth: Math.round(visualViewport!.width)
  }));
  // The real signal is whether anything sticks out past the width the device actually has.
  // Comparing scrollWidth to innerWidth alone cannot see this: when content overflows, the mobile
  // layout viewport grows to match it, so an overflowing page still reports them as equal.
  const culprits = await page.evaluate((limit: number) => {
    const insideHorizontalScroller = (element: Element) => {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && ancestor.scrollWidth > ancestor.clientWidth) return true;
      }
      return false;
    };
    const insideVisuallyHiddenContent = (element: Element) => {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const box = ancestor.getBoundingClientRect();
        if (style.position === 'absolute' && box.width <= 1 && box.height <= 1
          && (style.clip !== 'auto' || style.clipPath !== 'none')) return true;
      }
      return false;
    };
    return [...document.querySelectorAll('*')]
    .filter(el => {
      const box = el.getBoundingClientRect();
      return box.right > limit + 1 && getComputedStyle(el).position !== 'fixed'
        && !insideHorizontalScroller(el) && !insideVisuallyHiddenContent(el);
    })
    .map(el => {
      const box = el.getBoundingClientRect();
      return { sel: `${el.tagName}.${String(el.className).slice(0, 34)}`, text: el.textContent?.trim().slice(0, 80), left: Math.round(box.left), right: Math.round(box.right), pos: getComputedStyle(el).position };
    })
    .sort((a, b) => b.right - a.right || b.left - a.left)
    .slice(0, 8);
  }, fit.visualWidth);
  expect(culprits, `${label}: these elements overflow the viewport (${JSON.stringify(fit)})`).toEqual([]);
  expect(fit.scrollWidth, `${label}: page must fit its layout viewport (${JSON.stringify(fit)})`).toBeLessThanOrEqual(fit.innerWidth + 1);
  for (const dialog of await page.getByRole('dialog').all()) {
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), `${label}: dialog must fit`).toBe(true);
  }
  const overflow = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
    const scope = dialog || document.querySelector('main')!;
    const insideHorizontalScroller = (element: Element) => {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && ancestor.scrollWidth > ancestor.clientWidth) return true;
      }
      return false;
    };
    return [...scope.querySelectorAll('input,select,textarea,button,h1,h2,h3')].filter(el => {
      const box = el.getBoundingClientRect();
      return box.width && box.height && !insideHorizontalScroller(el) && (box.left < -1 || box.right > innerWidth + 1);
    }).map(el => el.getAttribute('aria-label') || el.textContent?.slice(0, 70));
  });
  expect(overflow, `${label}: controls and headings stay onscreen`).toEqual([]);
  const smallTargets = await page.evaluate(() => {
    const scope = [...document.querySelectorAll('dialog[open]')].at(-1) || document;
    const minimum = innerWidth < 1024 ? 44 : 36;
    // Role-only controls count too. Body-map muscle shapes are excluded because the muscle list
    // beside the figure is the full-size way to pick the same muscle.
    const controls = 'button,input:not([hidden]),select,textarea,summary,[role=button]:not(svg *),[role=option],[role=tab]';
    return [...scope.querySelectorAll(controls)].filter(el => {
      // A wrapped radio's whole label selects it; measure that actual target, not its small dot.
      const target = el instanceof HTMLInputElement && el.type === 'radio' && el.labels?.length
        ? el.labels[0] : el;
      const box = target.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (box.width < minimum - 1 || box.height < minimum - 1);
    }).map(el => el.getAttribute('aria-label') || el.textContent?.slice(0, 70));
  });
  expect(smallTargets, `${label}: controls have usable touch targets`).toEqual([]);
  if (page.viewportSize()!.width < 640) {
    const overlappingHeaders = await page.locator('.prescription-context-row:visible').evaluateAll(contexts => contexts.some(context => {
      const title = context.previousElementSibling;
      return title && title.getBoundingClientRect().bottom > context.getBoundingClientRect().top + 1;
    }));
    expect(overlappingHeaders, `${label}: exercise title stays above its context controls`).toBe(false);
  }
  const clippedPrescriptions = await page.locator('.set-grid-row:visible').evaluateAll(rows => rows.flatMap(row => {
    const bounds = row.getBoundingClientRect();
    return [...row.querySelectorAll('input, button')].filter(field => {
      const box = field.getBoundingClientRect();
      return box.width > 0 && (box.left < bounds.left - 1 || box.right > bounds.right + 1);
    }).map(field => field.getAttribute('aria-label'));
  }));
  expect(clippedPrescriptions, `${label}: prescription fields fit their own rows`).toEqual([]);


  const smallText = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      && el.textContent?.trim() && !['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(el.tagName)
      && Number.parseFloat(style.fontSize) < 14;
  }).map(el => {
    const visibleText = el.textContent?.trim() || '';
    return { tag: el.tagName, className: String(el.className).slice(0, 40), text: visibleText.slice(0, 40), size: getComputedStyle(el).fontSize };
  }));
  expect(smallText, `${label}: visible interface text is at least 14px`).toEqual([]);

  const clippedText = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,p,button,a,label,summary,span,small')].filter(el => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && el.textContent?.trim() && !el.closest('[aria-hidden="true"]')
      && !(style.position === 'absolute' && box.width <= 1 && box.height <= 1
        && (style.clip !== 'auto' || style.clipPath !== 'none'))
      && (style.overflowX === 'hidden' || style.overflowY === 'hidden' || style.textOverflow === 'ellipsis')
      && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
  }).map(el => ({ tag: el.tagName, className: String(el.className).slice(0, 40), text: el.textContent?.trim().slice(0, 60) })));
  expect(clippedText, `${label}: visible text is not clipped`).toEqual([]);

  const passiveButtons = await page.evaluate(() => [...document.querySelectorAll('.routine-row-static')]
    .filter(row => row.tagName === 'BUTTON').map(row => row.textContent?.trim().slice(0, 60)));
  expect(passiveButtons, `${label}: passive workout rows are not controls`).toEqual([]);
}

/// Everything that starts a workout, a program or an import now lives behind one New menu.
async function openNewMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'New', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function navigate(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click();
}

const signIn = (page: Page) => auth(page, USER);

test.afterEach(async ({ page }) => {
  // Some responsive cases transform API responses; ignore requests still in their route
  // callbacks when the page closes so they cannot fail the following case during teardown.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

for (const theme of ['dark', 'light']) {
  test(`active logger layout in ${theme} theme`, async ({ page }, info) => {
    await signIn(page);
    await page.evaluate(async () => {
      const headers = { 'X-Workout-Request': '1' };
      const response = await fetch('/api/workouts/active', { headers });
      const active = await response.json();
      if (active) await fetch(`/api/workouts/${active.id}/discard`, { method: 'POST', headers });
      await new Promise(resolve => {
        const request = indexedDB.deleteDatabase('workout-recovery');
        request.onsuccess = request.onerror = request.onblocked = resolve;
      });
    });
    const widths = [320, 390, 640, 768, 1024, 1440, 1920];
    const width = Number(info.project.name.match(/\d+/)?.[0] ?? 320);
    const summaries = [
      { mode: 'normal', goal: 'gain', rate: null, label: 'Gain goal · Normal progression', reason: 'does not verify a calorie surplus' },
      { mode: 'conservative', goal: 'lose', rate: 0.5, label: 'Loss goal · Conservative progression', reason: 'recorded rate below 0.75% per week' },
      { mode: 'preservation', goal: 'lose', rate: 0.9, label: 'Loss goal · Preservation progression', reason: 'recorded rate of 0.90% per week' }
    ] as const;
    const summary = summaries[(widths.indexOf(width) + (theme === 'light' ? 1 : 0)) % summaries.length];
    const applySummaryFixture = (session: Record<string, unknown>) => {
      if (session.active !== true) return session;
      session.nutritionContext = {
        subject: 'responsive-fixture', revision: 1, timeZone: 'UTC', effectiveGoal: summary.goal,
        phaseComplete: false, targetRatePercent: summary.rate, observedLossRatePercent: null,
        observedWindowDays: null, scaleWeightKg: null, scaleWeightDate: null, trendWeightKg: null,
        trendWeightDate: null, retrievedAt: session.startedAt, confirmed: true, cached: false, error: null
      };
      return session;
    };
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname !== '/api/bootstrap/launch' && !pathname.startsWith('/api/workouts')) return route.continue();
      const response = await route.fetch();
      if (!response.ok || !response.headers()['content-type']?.includes('application/json'))
        return route.fulfill({ response });
      const payload = await response.json() as Record<string, unknown>;
      const headers = { ...response.headers() };
      delete headers['content-length'];
      delete headers['content-encoding'];
      if (pathname === '/api/bootstrap/launch') {
        if (typeof payload.activeWorkout === 'object' && payload.activeWorkout !== null)
          payload.activeWorkout = applySummaryFixture(payload.activeWorkout as Record<string, unknown>);
        return route.fulfill({ status: response.status(), headers, json: payload });
      }
      return route.fulfill({ status: response.status(), headers, json: applySummaryFixture(payload) });
    });
    await page.reload();
    await navigate(page, 'Settings');
    await page.getByRole('group', { name: 'Appearance' })
      .getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light' }).click();
    await navigate(page, 'Workouts');
    await page.evaluate(async () => {
      const response = await fetch('/api/workouts', {
        method: 'POST', headers: { 'X-Workout-Request': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ templateId: null, name: 'Active layout check' })
      });
      if (!response.ok) throw new Error(await response.text());
    });
    await page.reload();
    const logger = page.getByRole('dialog', { name: 'Active layout check', exact: true });
    await logger.getByRole('button', { name: 'Add another exercise to this workout' }).click();
    const picker = page.getByRole('dialog', { name: 'Add an exercise', exact: true });
    await picker.getByRole('textbox', { name: 'Search exercises' }).fill('bench');
    await picker.getByRole('button', { name: 'Add Barbell bench press', exact: true }).click();
    await page.reload();
    const activeLogger = page.getByRole('dialog', { name: 'Active layout check', exact: true });
    // The figures behind the workout no longer take a row between sets; they open from the options menu.
    await expect(activeLogger.locator('.workout-summary')).toHaveCount(0);
    await activeLogger.getByRole('button', { name: 'Workout options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Workout details', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Workout details', exact: true });
    await expect(details).toContainText(summary.label);
    await expect(details).toContainText(summary.reason);
    await checkLayout(page, 'workout details');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-workout-details.png`) });
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
    await logger.getByRole('button', { name: 'Targets', exact: true }).click();
    const targets = page.getByRole('dialog', { name: 'Barbell bench press targets', exact: true });
    await checkLayout(page, 'workout targets');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-targets.png`) });
    await page.keyboard.press('Escape');
    await expect(targets).toBeHidden();
    await logger.getByRole('button', { name: 'Swap Barbell bench press', exact: true }).click();
    const swap = page.getByRole('dialog', { name: 'Swap Barbell bench press', exact: true });
    await checkLayout(page, 'workout swap');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-swap.png`) });
    await page.keyboard.press('Escape');
    await logger.getByRole('button', { name: 'Pause workout', exact: true }).click();
    await expect(logger.locator('.workout-active-exercise')).toBeVisible();
    // A paused workout stays editable; only logging a new set is held until it resumes.
    await expect(logger.locator('.workout-swipe-surface')).not.toHaveAttribute('inert', '');
    await expect(logger.getByRole('button', { name: /\(workout paused\)$/ }).first()).toBeVisible();
    await logger.getByRole('button', { name: 'Resume workout', exact: true }).click();
    await expect(logger.getByRole('button', { name: /\(workout paused\)$/ })).toHaveCount(0);
    await logger.getByRole('button', { name: 'Add set', exact: true }).click();
    const repsInput = logger.getByRole('spinbutton', { name: 'Barbell bench press set 1 reps', exact: true });
    await logger.getByRole('spinbutton', { name: 'Barbell bench press set 1 weight', exact: true }).fill('60');
    await repsInput.click();
    const entry = page.getByRole('dialog', { name: 'Reps & RIR', exact: true });
    await expect(entry).toBeVisible();
    await checkLayout(page, 'reps and RIR keypad');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-reps-rir-keypad.png`) });
    await entry.getByRole('button', { name: '8', exact: true }).click();
    await entry.getByRole('radio', { name: '2 RIR, 2 reps in reserve', exact: true }).click();
    await entry.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(entry).toBeHidden();
    await expect(repsInput).toBeFocused();
    await expect(repsInput).toHaveValue('8');
    await expect(logger.locator('.reps-rir-badge').first()).toHaveText('2');
    await repsInput.click();
    await entry.getByRole('button', { name: '9', exact: true }).click();
    await entry.getByRole('radio', { name: '1 RIR, 1 rep in reserve', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(entry).toBeHidden();
    await expect(repsInput).toHaveValue('8');
    await expect(logger.locator('.reps-rir-badge').first()).toHaveText('2');
    await logger.getByRole('button', { name: 'Log Barbell bench press set 1', exact: true }).click();
    await expect(logger.locator('.workout-rest-bar')).toBeVisible();
    expect(await logger.locator('.workout-rest-bar').evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(100);
    await checkLayout(page, 'active logger');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-active-logger.png`) });
    const exerciseNotes = logger.getByRole('textbox', { name: 'Exercise notes', exact: true });
    await exerciseNotes.fill('Keep a steady tempo. '.repeat(30));
    expect(await exerciseNotes.evaluate(node => node.scrollHeight <= node.clientHeight + 2)).toBe(true);
    await exerciseNotes.fill('Keep a steady tempo.');
    await expect(exerciseNotes).toBeInViewport({ ratio: 0.9 });
    await checkLayout(page, 'active logger notes');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-active-notes.png`) });
    const exerciseActions = logger.getByRole('button', { name: 'Actions for Barbell bench press', exact: true });
    await exerciseActions.click();
    await page.getByRole('menuitem', { name: 'Weight settings', exact: true }).click();
    const weights = page.getByRole('dialog', { name: 'Barbell bench press weights', exact: true });
    await checkLayout(page, 'active exercise weight settings');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-active-weight-settings.png`) });
    await page.keyboard.press('Escape');
    await expect(weights).toBeHidden();
    await expect(exerciseActions).toBeFocused();
    await logger.getByRole('button', { name: 'Workout options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Discard workout', exact: true }).click();
    await page.getByRole('button', { name: 'Discard workout', exact: true }).click();
    await expect(logger).toBeHidden();
  });

  test(`all views and dialogs in ${theme} theme`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    test.setTimeout(180000);

    await signIn(page);
    // Every viewport shares one account, so clear anything a previous run left in progress.
    const discarded = await page.evaluate(async () => {
      const headers = { 'X-Workout-Request': '1' };
      const response = await fetch('/api/workouts/active', { headers, cache: 'no-store' });
      const active = response.ok ? await response.json() : null;
      if (active) await fetch(`/api/workouts/${active.id}/discard`, { method: 'POST', headers });
      if ('indexedDB' in window) await new Promise(r => { const req = indexedDB.deleteDatabase('workout-recovery'); req.onsuccess = req.onerror = req.onblocked = r; });
      return Boolean(active);
    });
    if (discarded) await page.reload();

    await navigate(page, 'Settings');
    await expect(page.locator('.nav-label, .breadcrumb, .profile, .page-footer')).toHaveCount(0);
    await page.getByRole('group', { name: 'Appearance' })
      .getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page).toHaveTitle('Workout');
    await expect(page.locator('body')).not.toContainText(/repwise/i);

    const screenshot = async (label: string) => {
      await checkLayout(page, label);
      await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-${label}.png`) });
    };
    const cardScreenshot = async (card: Locator, label: string) => {
      // Give the isolated artifact enough vertical space to keep sticky shell controls outside it.
      // All layout assertions above still run at the project's original screen dimensions.
      const viewport = page.viewportSize()!;
      const height = await card.evaluate(element => element.getBoundingClientRect().height);
      await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, Math.ceil(height) + 300) });
      await card.screenshot({ animations: 'disabled', style: '.bottom-nav, .toast, .modal > header, .modal-actions { visibility: hidden !important; }', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-${label}.png`) });
      await page.setViewportSize(viewport);
    };
    await screenshot('settings');
    await expect(page.getByRole('heading', { name: 'Weight stacks', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Exercises with their own weights', exact: true })).toHaveCount(0);
    const plateWeights = page.getByRole('button', { name: 'Edit Plate-loaded weights', exact: true });
    await plateWeights.click();
    const plateEditor = page.getByRole('dialog', { name: 'Plate-loaded weights', exact: true });
    await plateEditor.getByRole('button', { name: 'Per side', exact: true }).click();
    await plateEditor.getByRole('spinbutton', { name: 'Smallest plate per side (kg)', exact: true }).fill('1.25');
    await screenshot('plate-loaded-weights');
    await plateEditor.getByRole('button', { name: 'Weight list', exact: true }).click();
    await plateEditor.getByRole('textbox', { name: 'Available weights (kg)', exact: true }).fill('2.5, 5, 7.5, 10');
    await screenshot('equipment-weight-list');
    await plateEditor.getByRole('button', { name: 'Create a sequence', exact: true }).click();
    await screenshot('equipment-weight-sequence');
    await plateEditor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(plateWeights).toBeFocused();

    await navigate(page, 'Overview');
    await expect(page.getByRole('region', { name: 'Training statistics' }).locator('.stat-label-text'))
      .toHaveText(['Workouts', 'Working sets', 'Training time']);
    await screenshot('overview');
    const calendar = page.getByRole('region', { name: 'Training calendar' });
    const currentWeek = calendar.getByRole('group', { name: 'Days of the week', exact: true });
    const days = currentWeek.locator('.calendar-day-cell');
    await expect(days).toHaveCount(7);
    const dayFit = await days.evaluateAll(elements => elements.every(element => {
      const box = element.getBoundingClientRect();
      return box.width >= 44 && box.height >= 44;
    }));
    expect(dayFit, 'calendar days retain touch targets within a horizontal rail').toBe(true);
    const rail = calendar.locator('.calendar-week-rail');
    // Return to this week appears only once the rail has left the current week.
    const reset = calendar.getByRole('button', { name: 'Return to this week' });
    await expect(reset).toHaveCount(0);
    if (page.viewportSize()!.width >= 1024) {
      await expect(calendar.getByRole('button', { name: 'Previous week' })).toBeVisible();
      await calendar.getByRole('button', { name: 'Previous week' }).click();
    } else {
      await expect(calendar.getByRole('button', { name: 'Previous week' })).toBeHidden();
      await expect(calendar.getByRole('button', { name: 'Next week' })).toBeHidden();
      await rail.evaluate(element => { element.scrollLeft = 0; });
    }
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(reset).toHaveCount(0);
    await rail.focus();
    await page.keyboard.press('ArrowRight');
    await expect(reset).toBeVisible();
    await reset.click();

    await navigate(page, 'Workouts');
    await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
    await screenshot('workouts');
    await page.getByRole('button', { name: 'New', exact: true }).filter({ visible: true }).first().click();
    await screenshot('new-action-menu');
    await page.keyboard.press('Escape');

    await openNewMenu(page, 'New workout');
    const editor = page.getByRole('dialog', { name: 'Build a workout' });
    // Every viewport project shares one account, so each run needs its own workout to act on.
    const workoutName = `Lower body strength and conditioning ${info.project.name} ${theme}`;
    await editor.getByLabel('Workout name').fill(workoutName);
    await screenshot('workout-editor');
    await editor.getByRole('button', { name: 'Add exercise', exact: true }).click();
    const builderPicker = page.getByRole('dialog', { name: 'Add exercise to workout', exact: true });
    await builderPicker.getByRole('textbox', { name: 'Search exercises' }).fill('squat');
    await screenshot('workout-picker');
    await builderPicker.getByRole('button', { name: 'Add Barbell back squat', exact: true }).click();
    // The picker collapsing changes the dialog's height; let it settle before aiming at Save.
    await expect(editor.getByRole('textbox', { name: 'Name for exercise 1' })).toHaveValue('Barbell back squat');
    await expect(builderPicker).toBeHidden();
    await screenshot('populated-workout-editor');
    await cardScreenshot(editor.locator('.workout-builder-exercise-card').first(), 'builder-card');
    await editor.getByRole('button', { name: 'Range', exact: true }).click();
    await screenshot('builder-range-prescriptions');
    await editor.getByRole('button', { name: 'Exact', exact: true }).click();
    await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
    await expect(editor).toBeHidden();

    await navigate(page, 'Exercises');
    await page.getByRole('textbox', { name: 'Search exercises' }).fill('barbell');
    await page.getByRole('group', { name: 'Filter exercises by muscle' }).getByRole('button', { name: 'Chest', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Barbell bench press' })).toBeVisible();
    await screenshot('exercises');

    // The detail sheet and its progress chart were never measured before; small chart labels and
    // sideways-scrolling bars hid there.
    await page.getByRole('button', { name: 'View Barbell bench press details' }).first().click();
    const detail = page.getByRole('dialog', { name: 'Barbell bench press', exact: true });
    await expect(detail).toBeVisible();
    await expect(detail.getByText('No workout history yet. Complete a workout to see progress here.', { exact: true })).toBeVisible();
    await expect(detail.locator('.detail-record-grid, .chart-table, .detail-selectors')).toHaveCount(0);
    await screenshot('exercise-detail');
    await detail.getByRole('button', { name: 'Edit weights', exact: true }).click();
    const exerciseWeights = page.getByRole('dialog', { name: 'Barbell bench press weights', exact: true });
    await exerciseWeights.getByRole('button', { name: 'Weight list', exact: true }).click();
    await exerciseWeights.getByRole('textbox', { name: /Available weights/ }).fill('5, 7.5, 12.5, 20, 27.5');
    await expect(exerciseWeights.getByRole('button', { name: 'Fill list', exact: true })).toHaveCount(0);
    await screenshot('exercise-weight-settings');
    await exerciseWeights.getByRole('button', { name: 'Create a sequence', exact: true }).click();
    await screenshot('exercise-weight-sequence');
    await exerciseWeights.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(detail.getByRole('button', { name: 'Edit weights', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();

    await navigate(page, 'Workouts');
    await openNewMenu(page, 'Import a PDF program');
    await screenshot('import-upload');
    // Uploading is rate limited per session, as it should be, and every viewport shares one
    // account here. The review screen is what this suite checks, so the first run creates the
    // draft and the rest open the one that already exists.
    // The list resumes a ready draft before its detail request has finished. Checking the heading
    // immediately races that request and mistakes a saved draft for a missing one.
    const importsResponse = await page.request.get('/api/imports');
    expect(importsResponse.ok()).toBe(true);
    const savedImports: ImportView[] = await importsResponse.json();
    const savedDraft = savedImports.some(view => view.fileName === 'responsive.pdf'
      && (view.status === 'ready' || view.status === 'pending') && !view.error);
    if (!savedDraft)
      await page.getByLabel('Program PDF').setInputFiles({ name: 'responsive.pdf', mimeType: 'application/pdf', buffer: pdf() });
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 60000 });
    await screenshot('import-review');
    const dayToggle = page.locator('.draft-day-summary').first();
    await dayToggle.click();
    const setRows = page.locator('.draft-day .set-grid-row:visible');
    await expect(setRows.first()).toBeVisible();
    const fieldsFit = await setRows.evaluateAll(rows => rows.every(row => {
      const bounds = row.getBoundingClientRect();
      return [...row.querySelectorAll('input, button')].filter(field => field.getBoundingClientRect().width > 0).every(field => {
        const box = field.getBoundingClientRect();
        return box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
      });
    }));
    expect(fieldsFit, 'expanded prescription controls fit inside their rows').toBe(true);
    await screenshot('expanded-import-day');
    await cardScreenshot(page.locator('.draft-day .import-exercise').first(), 'prescription-card');
    const prescriptionCard = page.locator('.draft-day .import-exercise').first();
    await prescriptionCard.getByRole('button', { name: 'Range', exact: true }).click();
    await screenshot('expanded-import-range');
    await prescriptionCard.getByRole('button', { name: 'Exact', exact: true }).click();
    await prescriptionCard.getByRole('textbox', { name: 'Description', exact: true }).fill('Responsive exercise edit preview');
    await expect(prescriptionCard.locator('[data-import-save-bar]')).toBeVisible();
    await screenshot('exercise-save-controls');
    await prescriptionCard.getByRole('button', { name: 'Save changes', exact: true }).click();
    const exerciseScope = page.getByRole('dialog', { name: 'Apply these changes to', exact: true });
    await expect(exerciseScope).toBeVisible();
    await exerciseScope.locator('.exercise-scope-option').first().click();
    await expect(exerciseScope.getByRole('radio', { name: /This occurrence only/ })).toBeChecked();
    await screenshot('exercise-edit-scope');
    await exerciseScope.getByRole('button', { name: 'Back', exact: true }).click();
    await prescriptionCard.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(prescriptionCard.locator('[data-import-save-bar]')).toBeHidden();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();

    await navigate(page, 'Overview');
    await screenshot('progress');

    await navigate(page, 'Muscles');
    await expect(page.getByRole('heading', { name: 'Muscle coverage', exact: true })).toBeVisible();
    await expect(page.locator('.body-map-detail')).toBeVisible();
    await screenshot('body');
    await page.getByText('How coverage is counted', { exact: true }).click();
    await screenshot('coverage-explanation');
    await page.locator('.muscle-balance-untrained summary').click();
    await screenshot('untrained-muscles');

    await navigate(page, 'Workouts');
    await page.locator('.routine-card').filter({ hasText: workoutName }).getByRole('button', { name: 'Start workout', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: workoutName, exact: true })).toBeVisible();
    await screenshot('workout-logger');
    await page.getByRole('button', { name: 'Add another exercise to this workout', exact: true }).click();
    await screenshot('logger-picker');
    await page.getByRole('dialog', { name: 'Add an exercise' }).getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Workout options', exact: true }).click();
    await screenshot('workout-options');
    await page.getByRole('menuitem', { name: 'Discard workout', exact: true }).click();
    await screenshot('discard-confirmation');
    await page.getByRole('button', { name: 'Keep training' }).click();
    await page.getByRole('button', { name: 'Minimize workout', exact: true }).click();
    await navigate(page, 'Overview');
    await expect(page.locator('.quick-start-hero')).toHaveCount(0);
    await expect(page.locator('.dashboard-quick-start')).toHaveCount(0);
    await screenshot('resume-banner');

    const resume = page.getByRole('button', { name: `Resume ${workoutName}`, exact: true });
    await expect(resume).toBeVisible();
    expect(await resume.evaluate(el => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);

    await resume.click();
    await page.getByRole('button', { name: 'Workout options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Discard workout', exact: true }).click();
    await page.getByRole('button', { name: 'Discard workout', exact: true }).click();
    // Wait for the discard to land: ending the test here would abort the request in flight and
    // leave an active workout behind for the next viewport to trip over.
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(resume).toBeHidden();
    expect(errors).toEqual([]);
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`populated history fits in ${theme} theme`, async ({ page }, info) => {
    const session = (id: string) => ({
      id, name: 'Full body strength with a deliberately long workout title',
      startedAt: '2026-09-25T08:00:00Z', finishedAt: '2026-09-25T09:00:00Z',
      completedSets: 3, volumeKg: 600, prCount: 3, note: 'A completed workout note.',
      exercises: [
        {
          id: 'history-rep-exercise', name: 'Long exercise name with a high repetition record',
          exerciseId: null, isPr: true, prKind: 'reps', prReps: 15,
          note: 'Keep a controlled tempo throughout each repetition and pause briefly before starting the next set.',
          sets: [{ id: 'rep-record', done: true, warmup: false, weightKg: 60, reps: 15, rir: null, rpe: null, isPr: true, prKind: 'reps', prReps: 15 }]
        },
        {
          id: 'history-strength-exercise', name: 'Estimated strength best exercise',
          exerciseId: null, isPr: true, prKind: 'e1rm', prE1rmKg: 75,
          note: '', sets: [{ id: 'strength-record', done: true, warmup: false, weightKg: 60, reps: 10, rir: '1', rpe: 9, isPr: true, prKind: 'e1rm', estimated1RmKg: 75 }]
        },
        {
          id: 'history-both-exercise', name: 'Combined strength and rep record exercise',
          exerciseId: null, isPr: true, prKind: 'both', prE1rmKg: 80, prReps: 20,
          note: '', sets: [{ id: 'combined-record', done: true, warmup: false, weightKg: 70, reps: 20, rir: '1', rpe: 9, isPr: true, prKind: 'both', prReps: 20, estimated1RmKg: 80 }]
        }
      ]
    });
    await page.route('**/api/history/summaries?*', async route => {
      const index = new URL(route.request().url()).searchParams.has('beforeAt') ? 1 : 0;
      const full = session(`history-polish-${index}`);
      await route.fulfill({ json: { total: 2, sessions: [{ ...full, exercises: [] }],
        nextBeforeAt: index === 0 ? full.finishedAt : null,
        nextBeforeId: index === 0 ? full.id : null, summaryOnly: true } });
    });
    await page.route('**/api/workouts/history-polish-*', async route => {
      const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
      await route.fulfill({ json: session(id) });
    });
    await signIn(page);
    await navigate(page, 'Settings');
    await page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light' }).click();
    await navigate(page, 'Overview');
    const history = page.getByRole('region', { name: 'Workout history' });
    await expect(history.locator('.history-row').first()).toBeVisible();
    await history.locator('.history-row').first().click();
    await expect(history.getByText('Rep best · 15 reps', { exact: true })).toBeVisible();
    await expect(history.getByText('Estimated strength best · 75 kg e1RM', { exact: true })).toBeVisible();
    await expect(history.getByText('Strength & rep best · 80 kg e1RM · 20 reps', { exact: true })).toBeVisible();
    await expect(history.getByText('Rep best', { exact: true }).first()).toBeVisible();
    await expect(history.getByText('Estimated strength best', { exact: true }).last()).toBeVisible();
    await expect(history.getByText('Strength & rep best', { exact: true }).last()).toBeVisible();
    await history.locator('.history-expanded-actions').scrollIntoViewIfNeeded();
    await expect(history.locator('.history-row')).toHaveCount(2);
    await checkLayout(page, 'populated history');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-populated-history.png`) });
  });
}
