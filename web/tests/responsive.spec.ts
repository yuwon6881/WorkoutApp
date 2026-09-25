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
    return [...scope.querySelectorAll('button,input:not([hidden]),select,textarea,summary')].filter(el => {
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
      await page.screenshot({ path: join(screenshotsDirectory, 'responsive', `${info.project.name}-${theme}-${label}.png`) });
    };
    await screenshot('settings');

    await navigate(page, 'Overview');
    await screenshot('overview');

    await navigate(page, 'Workouts');
    await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
    await screenshot('workouts');

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

    const importDetails = page.locator('details.import-details').filter({ has: page.getByText('Import details', { exact: true }) });
    if (await importDetails.count()) {
      const summary = importDetails.locator('summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(importDetails).toHaveAttribute('open', '');
      await page.keyboard.press('Enter');
      await expect(importDetails).not.toHaveAttribute('open', '');
    }

    await navigate(page, 'Overview');
    await screenshot('progress');

    await navigate(page, 'Muscles');
    await expect(page.getByRole('heading', { name: 'Muscle coverage', exact: true })).toBeVisible();
    await expect(page.locator('.body-map-detail')).toBeVisible();
    await screenshot('body');

    await navigate(page, 'Workouts');
    await page.locator('.routine-card').filter({ hasText: workoutName }).getByRole('button', { name: 'Start workout', exact: true }).click();
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
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await screenshot('discard-confirmation');
    await page.getByRole('button', { name: 'Keep training' }).click();
    await page.getByRole('button', { name: 'Minimize', exact: true }).click();
    await screenshot('resume-banner');

    const resume = page.getByRole('button', { name: `Resume ${workoutName}`, exact: true });
    await expect(resume).toBeVisible();
    expect(await resume.evaluate(el => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);

    await resume.click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.getByRole('button', { name: 'Discard workout', exact: true }).click();
    // Wait for the discard to land: ending the test here would abort the request in flight and
    // leave an active workout behind for the next viewport to trip over.
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(resume).toBeHidden();
    expect(errors).toEqual([]);
  });
}
