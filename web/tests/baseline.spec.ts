import { expect, test } from '@playwright/test';

// Pixel baselines for surfaces whose appearance does not depend on account data or the date.
// The first-load skeleton is drawn while the bootstrap request is outstanding, so the request is
// held open for the capture. Update deliberately with --update-snapshots after a design change.
for (const theme of ['dark', 'light'] as const) {
  test(`first-load skeleton matches the shell in ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.route('**/api/bootstrap', () => new Promise(() => undefined));
    await page.addInitScript(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.goto('/');
    await expect(page.locator('.app-loading-shell')).toBeVisible();
    await expect(page).toHaveScreenshot(`skeleton-${theme}.png`, { animations: 'disabled', maxDiffPixelRatio: 0.01 });
  });
}
