import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { signIn } from './signIn';

async function addWeek(page: Page) {
  await page.getByRole('button', { name: 'Add week', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add a week', exact: true }).getByRole('button', { name: /Start empty/ }).click();
}

/** A real mouse drag, so the browser's own drag and drop runs rather than a synthetic event. */
async function drag(page: Page, from: Locator, to: Locator, onHover?: () => Promise<void>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2, { steps: 15 });
  await onHover?.();
  await page.mouse.up();
}

test('a week moves within its block and is refused by another block', async ({ page }) => {
  await signIn(page, 'e2e-lifter');
  await page.getByRole('button', { name: 'Workouts', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'New', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: 'New program', exact: true }).click();
  await page.getByLabel('Program name').fill(`Week drag ${Date.now()}`);
  await addWeek(page);
  await addWeek(page);
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  const selected = () => page.locator('[role=tab][aria-selected=true]').filter({ hasText: /^Week/ });

  // Weeks 1 to 3 are one block, week 4 another.
  await page.getByRole('tab', { name: 'Block 1', exact: true }).click();
  await page.getByRole('tab', { name: 'Week 1', exact: true }).click();
  await drag(page, page.getByRole('tab', { name: 'Week 1', exact: true }), page.getByRole('tab', { name: 'Week 3', exact: true }));
  await expect(selected()).toHaveText('Week 3');

  await page.getByRole('tab', { name: 'Week 1', exact: true }).click();
  const outsider = page.locator('[data-import-week-chip="4"]');
  await drag(page, page.getByRole('tab', { name: 'Week 1', exact: true }), outsider.getByRole('tab'), async () => {
    await expect(outsider).toHaveAttribute('data-drop-blocked', 'true');
    await expect(page.locator('[data-import-week-chip="2"]')).not.toHaveAttribute('data-drop-blocked', 'true');
  });
  await expect(selected()).toHaveText('Week 1');
  await expect(page.locator('[data-drop-blocked]')).toHaveCount(0);
});
