import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { pdf } from './pdfFixture';
import type { ImportView } from '../src/types';
import type { Page } from '@playwright/test';

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

const legacyFailure: ImportView = {
  ...failedImport, status: 'failed', stage: 'failed',
  fileName: 'The_Min-Max_Program__5X.pdf',
  error: 'This PDF is too large for one AI visual input and has no readable text. Provide a text-readable copy or split the scanned document into smaller files.',
  reviewIssues: []
};

async function savedImports(page: Page, views: ImportView[]) {
  let imports = views;
  await page.route('**/api/bootstrap/launch', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), imports } });
  });
  await page.route('**/api/imports', route => route.request().method() === 'GET'
    ? route.fulfill({ json: imports }) : route.continue());
  for (const view of views) {
    await page.route(`**/api/imports/${view.id}`, route => route.fulfill({ json: view }));
    await page.route(`**/api/imports/${view.id}/discard`, route => {
      imports = imports.filter(item => item.id !== view.id);
      return route.fulfill({ status: 204 });
    });
  }
  return (next: ImportView[]) => { imports = next; };
}

test('reload and discarding another draft never select an older failed import', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const ready: ImportView = {
    ...legacyFailure, id: '00000000-0000-4000-8000-000000000030',
    fileName: 'Unrelated workout.pdf', created: '2026-10-01T08:00:00Z',
    status: 'ready', stage: 'done', error: '', acceptable: true,
    draft: { programName: 'Unrelated workout', workouts: [{
      lineId: '00000000-0000-4000-8000-000000000031', week: 1, name: 'Rest',
      focus: null, notes: null, exercises: [], block: null, phase: null, phaseWeek: 1, isRestDay: true,
      blockId: '00000000-0000-4000-8000-000000000033', weekId: '00000000-0000-4000-8000-000000000034'
    }] }
  };
  await savedImports(page, [ready, legacyFailure]);
  await page.goto('/import');
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Draft actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Discard draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Import a program' })).toBeVisible();
  const failure = page.getByRole('region', { name: 'This PDF could not be imported' });
  await expect(failure).toHaveCount(0);
  await expect(page.getByText(legacyFailure.error, { exact: true })).toHaveCount(0);

  for (const theme of ['dark', 'light'] as const) {
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
    await page.screenshot({ path: join(screenshotsDirectory, `${testInfo.project.name}-stopped-imports-${theme}.png`) });
    if (testInfo.project.name === 'import-failure-desktop') {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.screenshot({ path: join(screenshotsDirectory, `tablet-stopped-imports-${theme}.png`) });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  }
  await page.getByText('Stopped imports (1)', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: join(screenshotsDirectory, `${testInfo.project.name}-stopped-imports-expanded.png`) });
  if (testInfo.project.name === 'import-failure-desktop') {
    await page.setViewportSize({ width: 768, height: 1024 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const target = await page.getByRole('button', { name: `View ${legacyFailure.fileName}`, exact: true }).boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: join(screenshotsDirectory, 'tablet-stopped-imports-expanded.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.getByRole('button', { name: `View ${legacyFailure.fileName}`, exact: true }).click();
  await expect(failure).toContainText(legacyFailure.fileName);
  await expect(failure.getByRole('alert')).toContainText(legacyFailure.error);
  await failure.getByRole('button', { name: 'Discard import', exact: true }).click();
  await expect(failure).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Import a program' })).toBeVisible();
  await expect(page.getByText('Stopped imports (1)', { exact: true })).toHaveCount(0);
  await expect(failure).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('a new PDF clears the selected old failure and shows only its own terminal error', async ({ page }) => {
  const current: ImportView = {
    ...legacyFailure, id: '00000000-0000-4000-8000-000000000032',
    fileName: 'Current workout.pdf', created: '2026-10-01T09:00:00Z', error: 'The current read stopped.'
  };
  const update = await savedImports(page, [legacyFailure, current]);
  update([legacyFailure]);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/imports', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await hold;
    update([current, legacyFailure]);
    await route.fulfill({ json: current });
  });
  await page.goto('/import');
  await page.getByText('Stopped imports (1)', { exact: true }).click();
  await page.getByRole('button', { name: `View ${legacyFailure.fileName}`, exact: true }).click();
  const failure = page.getByRole('region', { name: 'This PDF could not be imported' });
  await expect(failure).toContainText(legacyFailure.fileName);
  await page.getByLabel('Program PDF').setInputFiles({ name: 'Wrong file.txt', mimeType: 'text/plain', buffer: Buffer.from('Text') });
  await expect(failure).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Choose a PDF file.');
  await page.getByRole('button', { name: `View ${legacyFailure.fileName}`, exact: true }).click();
  await expect(failure).toContainText(legacyFailure.fileName);
  const submitted = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/imports');
  await page.getByLabel('Program PDF').setInputFiles({ name: current.fileName, mimeType: 'application/pdf', buffer: pdf(1, 'New program') });
  await submitted;
  try {
    await expect(failure).toHaveCount(0);
    await page.getByRole('button', { name: 'Overview', exact: true }).filter({ visible: true }).first().click();
    await page.locator('.import-progress-pill').click();
    await expect(page.getByRole('heading', { name: 'Import a program' })).toBeVisible();
    await expect(failure).toHaveCount(0);
    release();
    await expect(failure).toContainText(current.fileName);
    await expect(failure.getByRole('alert')).toContainText(current.error);
    await expect(failure).not.toContainText(legacyFailure.fileName);
    await expect(page.getByText(legacyFailure.error, { exact: true })).toHaveCount(0);
  } finally { release(); }
});

test('a stopped import explains what was doubted, where, and what to do next', async ({ page }, testInfo) => {
  // Imports arrive with the app's bootstrap; everything else in it stays the account's own.
  await page.route('**/api/bootstrap/launch', async route => {
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
  await expect(panel).toHaveCount(0);
  await page.getByText('Stopped imports (1)', { exact: true }).click();
  await page.getByRole('button', { name: `View ${failedImport.fileName}`, exact: true }).click();
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
