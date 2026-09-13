import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signIn as auth } from './signIn';

const USER = 'e2e-responsive';
const PASSWORD = 'a responsive test password';
const pdf = (pages = 3) => Buffer.from(`%PDF-1.7\n${'/Type /Page \n'.repeat(pages)}%%EOF`, 'latin1');

async function checkLayout(page: Page, label: string) {
  // Comparing against innerWidth is not enough: when content overflows, the mobile layout
  // viewport grows to match it, so an overflowing page still reports scrollWidth === innerWidth.
  // The visual viewport is the width the device actually has.
  const fit = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    visualWidth: Math.round(visualViewport!.width)
  }));
  expect(fit.innerWidth, `${label}: layout viewport must not be inflated by overflow (${JSON.stringify(fit)})`).toBeLessThanOrEqual(fit.visualWidth + 1);
  expect(fit.scrollWidth, `${label}: page must fit (${JSON.stringify(fit)})`).toBeLessThanOrEqual(fit.visualWidth + 1);
  for (const dialog of await page.getByRole('dialog').all()) {
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), `${label}: dialog must fit`).toBe(true);
  }
  const overflow = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
    const scope = dialog || document.querySelector('main')!;
    return [...scope.querySelectorAll('input,select,textarea,button,h1,h2,h3')].filter(el => {
      const box = el.getBoundingClientRect();
      return box.width && box.height && (box.left < -1 || box.right > innerWidth + 1);
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
}

async function navigate(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click();
}

const signIn = (page: Page) => auth(page, USER, PASSWORD);

for (const theme of ['dark', 'light']) {
  test(`all views and dialogs in ${theme} theme`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    test.setTimeout(180000);

    await signIn(page);
    await navigate(page, 'Settings');
    await page.getByLabel('Appearance').selectOption(theme === 'dark' ? 'dark' : 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page).toHaveTitle('Workout');
    await expect(page.locator('body')).not.toContainText(/repwise/i);

    const screenshot = async (label: string) => {
      await checkLayout(page, label);
      await page.screenshot({ path: `artifacts/responsive/${info.project.name}-${theme}-${label}.png` });
    };
    await screenshot('settings');
    await page.getByRole('button', { name: 'Install app', exact: true }).click();
    await screenshot('install-dialog');
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await screenshot('password-dialog');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await navigate(page, 'Overview');
    await screenshot('overview');

    await navigate(page, 'Workouts');
    await expect(page.getByRole('heading', { name: 'Your workouts.' })).toBeVisible();
    await screenshot('workouts');

    await page.getByRole('button', { name: 'New workout', exact: true }).first().click();
    const editor = page.getByRole('dialog', { name: 'Build a workout' });
    // Every viewport project shares one account, so each run needs its own workout to act on.
    const workoutName = `Lower body strength and conditioning ${info.project.name} ${theme}`;
    await editor.getByLabel('Workout name').fill(workoutName);
    await screenshot('workout-editor');
    await editor.getByRole('button', { name: 'Add exercise', exact: true }).click();
    await editor.getByRole('textbox', { name: 'Search exercises' }).fill('squat');
    await screenshot('workout-picker');
    await editor.getByRole('button', { name: 'Add Barbell back squat', exact: true }).click();
    // The picker collapsing changes the dialog's height; let it settle before aiming at Save.
    await expect(editor.getByText('Barbell back squat', { exact: true })).toBeVisible();
    await expect(editor.getByRole('textbox', { name: 'Search exercises' })).toBeHidden();
    await editor.getByRole('button', { name: 'Save workout', exact: true }).click();
    await expect(editor).toBeHidden();

    await navigate(page, 'Exercises');
    await page.getByRole('textbox', { name: 'Search exercises' }).fill('barbell');
    await page.getByLabel('Filter by muscle').selectOption('Chest');
    await expect(page.getByRole('heading', { name: 'Barbell bench press' })).toBeVisible();
    await screenshot('exercises');

    await navigate(page, 'Workouts');
    await page.getByRole('button', { name: 'Import a PDF program', exact: true }).click();
    await screenshot('import-empty');
    await page.getByLabel('Program PDF').setInputFiles({ name: 'responsive.pdf', mimeType: 'application/pdf', buffer: pdf() });
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible({ timeout: 60000 });
    await screenshot('import-review');
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review' })).toBeHidden({ timeout: 30000 });

    await navigate(page, 'Progress');
    await screenshot('progress');

    await navigate(page, 'Workouts');
    await page.locator('.routine-card').filter({ hasText: workoutName }).getByRole('button', { name: 'Start workout', exact: true }).click();
    const preview = page.getByRole('dialog', { name: `Start ${workoutName}?`, exact: true });
    await expect(preview).toBeVisible();
    await screenshot('start-preview');
    await preview.getByRole('button', { name: 'Start workout', exact: true }).click();
    await expect(preview).toBeHidden();
    await expect(page.getByRole('dialog')).toBeVisible();
    await screenshot('workout-logger');
    await page.getByRole('button', { name: 'Add exercise', exact: true }).click();
    await screenshot('logger-picker');
    await page.getByRole('dialog', { name: 'Add an exercise' }).getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await screenshot('discard-confirmation');
    await page.getByRole('button', { name: 'Keep training' }).click();
    await page.getByRole('button', { name: 'Minimize' }).click();
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
    expect(errors).toEqual([]);
  });
}
