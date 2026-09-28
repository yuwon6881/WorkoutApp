import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const screenshotsDirectory = process.env.WORKOUT_TEST_SCREENSHOTS || 'artifacts';

/// An import the server stopped because a page could not be read as printed. The list endpoint is
/// answered locally, so the screen can be checked without a document that fails to read.
const failedImport = {
  id: '00000000-0000-4000-8000-000000000029', status: 'failed', fileName: 'Pure Bodybuilding - Full Body.pdf', pages: 55,
  error: 'The PDF could not be verified completely [program_week_gap] on PDF page 29 (field: week): Program week 5 has no days.',
  created: '2026-09-27T08:00:00Z', model: 'printed-tables', stage: 'failed', chunksDone: 3, chunksTotal: 4,
  currentChunkLabel: null, unresolvedCount: 0, draft: null, unresolved: [], acceptable: false, programId: null,
  reviewIssues: [
    { code: 'program_week_gap', message: 'Program week 5 has no days, although the PDF prints it on pages 29-33.', severity: 'warning', sourcePage: 29, targetField: 'week' },
    { code: 'rest_unread', message: 'One rest time is missing, and the PDF table does not show it as blank.', severity: 'warning', sourcePage: 31, targetField: 'rest' },
    { code: 'printed_rows_used', message: 'The printed rows decided these days.', severity: 'info' }
  ],
  alternatives: [], revision: 1
};

test('a stopped import explains what was doubted, where, and what to do next', async ({ page }, testInfo) => {
  // Imports arrive with the app's bootstrap; everything else in it stays the account's own.
  await page.route('**/api/bootstrap/shell', async route => {
    const response = await route.fetch();
    route.fulfill({ response, json: { ...(await response.json()), imports: [failedImport] } });
  });
  await page.route('**/api/imports', route => route.request().method() === 'GET'
    ? route.fulfill({ json: [failedImport] }) : route.continue());
  await page.route(`**/api/imports/${failedImport.id}`, route => route.fulfill({ json: failedImport }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Workouts', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'New', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: 'Import a PDF program', exact: true }).click();

  const panel = page.getByRole('region', { name: 'This PDF could not be imported' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('alert')).toContainText('Weeks are missing');
  await expect(panel.getByRole('alert')).toContainText('PDF page 29');
  await expect(panel.getByRole('listitem').first()).toContainText('Open page 29 of the PDF');
  // Codes stay out of the way until asked for; informational notes are not listed as problems.
  await expect(panel.getByText('[program_week_gap]')).toBeHidden();
  await expect(panel.getByText('1 more item to check')).toBeVisible();
  await expect(panel.getByText('The printed rows decided these days.')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Choose another PDF' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Discard import' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  const html = page.locator('html');
  for (const theme of ['dark', 'light'] as const) {
    await html.evaluate((element, value) => element.setAttribute('data-theme', value), theme);
    await panel.screenshot({ path: join(screenshotsDirectory, `${testInfo.project.name}-import-failed-${theme}.png`) });
  }
});
