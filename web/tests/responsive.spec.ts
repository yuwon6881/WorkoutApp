import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { signIn as auth } from './signIn';
import { pdf } from './pdfFixture';

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
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (box.width < minimum - 1 || box.height < minimum - 1);
    }).map(el => el.getAttribute('aria-label') || el.textContent?.slice(0, 70));
  });
  expect(smallTargets, `${label}: controls have usable touch targets`).toEqual([]);

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
    await page.reload();
    await navigate(page, 'Settings');
    await page.getByRole('group', { name: 'Appearance' })
      .getByRole('button', { name: theme === 'dark' ? 'Ayu dark' : 'Ayu light' }).click();
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
    await logger.getByRole('button', { name: 'Add set', exact: true }).click();
    await logger.getByRole('spinbutton', { name: 'Barbell bench press set 1 reps', exact: true }).fill('8');
    await logger.getByRole('spinbutton', { name: 'Barbell bench press set 1 weight', exact: true }).fill('60');
    await logger.getByRole('button', { name: 'Log Barbell bench press set 1', exact: true }).click();
    await expect(logger.locator('.rest-bar.resting')).toBeVisible();
    await checkLayout(page, 'active logger');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-active-logger.png`) });
    const exerciseNotes = logger.getByRole('textbox', { name: 'Exercise notes', exact: true });
    await exerciseNotes.fill('Keep a steady tempo.');
    await expect(exerciseNotes).toBeInViewport({ ratio: 0.9 });
    await checkLayout(page, 'active logger notes');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-active-notes.png`) });
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
      .getByRole('button', { name: theme === 'dark' ? 'Ayu dark' : 'Ayu light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page).toHaveTitle('Workout');
    await expect(page.locator('body')).not.toContainText(/repwise/i);

    const screenshot = async (label: string) => {
      await checkLayout(page, label);
      await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-${label}.png`) });
    };
    await screenshot('settings');

    await navigate(page, 'Overview');
    await screenshot('overview');
    const calendar = page.getByRole('region', { name: 'Training calendar' });
    const days = calendar.locator('.calendar-day-cell');
    await expect(days).toHaveCount(7);
    const dayFit = await days.evaluateAll(elements => elements.every(element => {
      const box = element.getBoundingClientRect();
      const grid = element.parentElement!.getBoundingClientRect();
      return box.left >= grid.left - 1 && box.right <= grid.right + 1 && box.width >= 44 && box.height >= 44;
    }));
    expect(dayFit, 'all seven days fit their calendar and retain touch targets').toBe(true);
    await expect(calendar.getByRole('button', { name: 'Return to this week' })).toBeDisabled();
    await calendar.getByRole('button', { name: 'Previous week' }).click();
    await expect(calendar.getByRole('button', { name: 'Return to this week' })).toBeEnabled();
    await calendar.getByRole('button', { name: 'Return to this week' }).click();
    await expect(calendar.getByRole('button', { name: 'Return to this week' })).toBeDisabled();

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
    const detail = page.getByRole('dialog', { name: /Barbell bench press/ });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('heading', { name: 'Progress' })).toBeVisible();
    await screenshot('exercise-detail');
    await detail.getByRole('button', { name: 'Edit weights', exact: true }).click();
    await detail.getByRole('button', { name: 'Weight list', exact: true }).click();
    await detail.getByRole('textbox', { name: /Available weights/ }).fill('5, 7.5, 12.5, 20, 27.5');
    await screenshot('exercise-weight-settings');
    await detail.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();

    await navigate(page, 'Workouts');
    await openNewMenu(page, 'Import a PDF program');
    await screenshot('import-upload');
    // Uploading is rate limited per session, as it should be, and every viewport shares one
    // account here. The review screen is what this suite checks, so the first run creates the
    // draft and the rest open the one that already exists.
    const existing = page.locator('.history-row').filter({ hasText: 'responsive.pdf' }).first();
    if (await existing.isVisible().catch(() => false)) await existing.click();
    else await page.getByLabel('Program PDF').setInputFiles({ name: 'responsive.pdf', mimeType: 'application/pdf', buffer: pdf() });
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
    await page.locator('.draft-day .import-exercise').first().screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-prescription-card.png`) });
    const prescriptionCard = page.locator('.draft-day .import-exercise').first();
    await prescriptionCard.getByRole('button', { name: 'Range', exact: true }).click();
    await screenshot('expanded-import-range');
    await prescriptionCard.getByRole('button', { name: 'Exact', exact: true }).click();


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
    const preview = page.getByRole('dialog', { name: `Start ${workoutName}?`, exact: true });
    await expect(preview).toBeVisible();
    await screenshot('start-preview');
    await preview.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(page.getByRole('dialog')).toBeVisible();
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
      completedSets: 2, volumeKg: 600, prCount: 1, note: 'A completed workout note.',
      exercises: [{
        id: 'history-exercise', name: 'Long exercise name with bodyweight and loaded working sets',
        exerciseId: null, isPr: true, prE1rmKg: 75,
        note: 'Keep a controlled tempo throughout each repetition and pause briefly before starting the next set.',
        sets: [
          { id: 'unknown-load', done: true, warmup: false, weightKg: null, reps: 12, rir: '3', rpe: 7, isPr: false },
          { id: 'record-load', done: true, warmup: false, weightKg: 60, reps: 10, rir: '1', rpe: 9, isPr: true }
        ]
      }]
    });
    await page.route('**/api/history?*', async route => {
      const index = Number(new URL(route.request().url()).searchParams.get('page'));
      await route.fulfill({ json: { page: index, size: 1, total: 2, sessions: [session(`history-polish-${index}`)] } });
    });
    await signIn(page);
    await navigate(page, 'Settings');
    await page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: theme === 'dark' ? 'Ayu dark' : 'Ayu light' }).click();
    await navigate(page, 'Overview');
    const history = page.getByRole('region', { name: 'Workout history' });
    await expect(history.locator('.history-row').first()).toBeVisible();
    await history.locator('.history-row').first().click();
    await expect(history.getByText('12 reps', { exact: true })).toBeVisible();
    await expect(history.locator('.pr-exercise-badge')).toBeVisible();
    await history.locator('.history-expanded-actions').scrollIntoViewIfNeeded();
    await expect(history.locator('.history-row')).toHaveCount(2);
    await checkLayout(page, 'populated history');
    await page.screenshot({ animations: 'disabled', path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-populated-history.png`) });
  });
}
