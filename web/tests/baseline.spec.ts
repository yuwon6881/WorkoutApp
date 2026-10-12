import { expect, test } from '@playwright/test';

// Pixel baselines for surfaces whose appearance does not depend on account data or the date.
// The first-load skeleton is drawn while the bootstrap request is outstanding, so the request is
// held open for the capture. Update deliberately with --update-snapshots after a design change.
for (const theme of ['dark', 'light'] as const) {
  test(`first-load skeleton matches the shell in ${theme} theme`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.route('**/api/bootstrap/launch', () => new Promise(() => undefined));
    await page.addInitScript(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.goto('/');
    await expect(page.locator('.app-loading-shell')).toBeVisible();
    await expect(page.locator('.app-loading .overview-hero-calendar-grid')).toBeVisible();
    await expect(page.locator('.app-loading .skeleton-stat')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath(`skeleton-${theme}-review.png`), animations: 'disabled' });
    await expect(page).toHaveScreenshot(`skeleton-${theme}.png`, { animations: 'disabled', threshold: 0.05, maxDiffPixelRatio: 0.01 });
  });
}
