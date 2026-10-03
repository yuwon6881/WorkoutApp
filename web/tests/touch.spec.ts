import { expect, test } from '@playwright/test';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { signIn } from './signIn';

// Real touch input through the Chrome DevTools protocol. Synthetic PointerEvents skip the browser's
// own gesture handling, so they cannot show whether touch-action and scrolling let a gesture
// through; these do.
async function drag(page: Page, cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= steps; step += 1) {
    const point = { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
    await page.waitForTimeout(12);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function centre(locator: Locator) {
  // Measure after entrance/spring transitions finish; normal-motion coordinates change
  // while a sheet settles. This preserves and exercises the real animation.
  await locator.evaluate(async element => {
    const dialog = element.closest('dialog');
    await Promise.all((dialog?.getAnimations() ?? []).map(animation => animation.finished.catch(() => undefined)));
  });
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('overview weeks scroll with a finger and keep phone navigation compact', async ({ page }) => {
  const calendar = page.getByRole('region', { name: 'Training calendar' });
  const rail = calendar.locator('.calendar-week-rail');
  await expect(rail).toBeVisible();
  await expect(calendar.getByRole('button', { name: 'Previous week' })).toBeHidden();
  await expect(calendar.getByRole('button', { name: 'Next week' })).toBeHidden();
  // Return to this week appears only once the rail has left the current week.
  const reset = calendar.getByRole('button', { name: 'Return to this week' });
  await expect(reset).toHaveCount(0);
  const cdp = await page.context().newCDPSession(page);
  const box = (await rail.boundingBox())!;
  await drag(page, cdp, { x: box.x + box.width - 20, y: box.y + 30 },
    { x: box.x + 20, y: box.y + 30 }, 20);
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect(calendar.getByRole('group', { name: 'Days of the week', exact: true })).toBeInViewport();
});

test('a bottom sheet closes when its header is dragged down', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await page.getByRole('button', { name: 'Workouts', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'New', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: 'New workout', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Build a workout' });
  await expect(editor).toBeVisible();

  // A short drag springs back; a long one dismisses, like the close button.
  const header = editor.locator('header').first();
  const start = await centre(header);
  await drag(page, cdp, { x: start.x - 60, y: start.y }, { x: start.x - 60, y: start.y + 40 });
  await expect(editor).toBeVisible();
  const settled = await centre(header);
  await drag(page, cdp, { x: settled.x - 60, y: settled.y }, { x: settled.x - 60, y: settled.y + 320 });
  await expect(editor).toBeHidden();
});

test('an option list opens as a bottom sheet on a phone and Back closes it', async ({ page }) => {
  await page.getByRole('button', { name: 'Muscles', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Muscle coverage period', exact: true }).click();
  const list = page.getByRole('listbox', { name: 'Muscle coverage period', exact: true });
  await expect(list).toBeVisible();
  await expect(list).toHaveClass(/picker-sheet/);
  const box = (await list.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 2);
  expect(Math.round(box.width)).toBe(viewport.width);

  await page.goBack();
  await expect(list).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Muscle coverage', exact: true })).toBeVisible();
});

test('the on-screen keyboard hides the bottom navigation instead of sitting on it', async ({ page }) => {
  await page.getByRole('button', { name: 'Exercises', exact: true }).filter({ visible: true }).first().click();
  const search = page.getByRole('textbox', { name: 'Search exercises' });
  await search.focus();
  const viewport = page.viewportSize()!;
  // An on-screen keyboard shrinks the visual viewport by roughly half of a phone's height.
  await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.55) });
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'open');
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect(search).toBeInViewport();

  await search.blur();
  await page.setViewportSize(viewport);
  await expect(page.locator('html')).not.toHaveAttribute('data-keyboard', 'open');
  await expect(page.locator('.bottom-nav')).toBeVisible();
});
