import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fixture = (name: string) => resolve('tests', 'fixtures', name);
const requestHeaders = { Origin: `http://localhost:${process.env.WORKOUT_TEST_WEB_PORT || '5182'}`, 'X-Workout-Request': '1' };

async function cleanDrafts(page: import('@playwright/test').Page) {
  const response = await page.request.get('/api/imports');
  if (!response.ok()) return;
  const imports = await response.json() as { id: string }[];
  for (const item of imports) await page.request.post(`/api/imports/${item.id}/discard`, { headers: requestHeaders });
}

test.beforeEach(async ({ page }) => { await cleanDrafts(page); });
test.afterEach(async ({ page }) => { await cleanDrafts(page); });

for (const theme of ['light', 'dark']) {
  test(`prompt, file errors and responsive layout in ${theme}`, async ({ page, context }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/import');
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const panel = page.locator('.iep-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Copy prompt' }).focus();
    await expect(panel.getByRole('button', { name: 'Copy prompt' })).toBeFocused();
    await panel.getByRole('button', { name: 'Copy prompt' }).click();
    await expect(panel.getByText('The prompt is on your clipboard.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('complete source');
    const input = page.getByLabel('Program JSON file');
    await input.setInputFiles(fixture('external-invalid.json'));
    const first = '$.program.days[0].exercises[0].badField';
    const second = '$.program.days[0].exercises[1].extraField';
    const third = '$.program.days[0].exercises[0].otherField';
    await expect(panel.getByText(first, { exact: true })).toBeVisible();
    await expect(panel.getByText(second, { exact: true })).toBeVisible();
    await expect(panel.getByText(third, { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Copy errors for your AI assistant' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(first);
    expect(copied).toContain(second);
    expect(copied).toContain(third);
    expect(await (await page.request.get('/api/imports')).json()).toEqual([]);
    await input.setInputFiles({ name: 'wrong.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not json') });
    await expect(panel.getByRole('alert')).toContainText('ending in .json');
    await input.setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(8 * 1024 * 1024 + 1, 32) });
    await expect(panel.getByRole('alert')).toContainText('larger than 8 MB');
    await input.setInputFiles({ name: 'invalid-encoding.json', mimeType: 'application/json', buffer: Buffer.from([0xff]) });
    await expect(panel.getByRole('alert')).toContainText('UTF-8');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (info.project.name !== '1440px') {
      for (const button of await panel.getByRole('button').filter({ visible: true }).all())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`external-errors-${theme}.png`), fullPage: true });
  });

  test(`review alternatives and accept in ${theme}`, async ({ page }, info) => {
    await page.goto('/import');
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.getByLabel('Program JSON file').setInputFiles(fixture('external-alternative.json'));
    await expect(page.getByRole('heading', { name: 'Choose a week version' })).toBeVisible();
    if (info.project.name !== '1440px') {
      for (const button of await page.locator('.ialt-panel').getByRole('button').filter({ visible: true }).all()) {
        const box = (await button.boundingBox())!;
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
      }
    }
    await page.locator('.ialt-card').filter({ hasText: 'Option A' }).click();
    await page.getByRole('button', { name: 'Continue with selected version' }).click();
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Source JSON' })).toBeVisible();
    await expect(page.getByText('Check the movement')).toBeVisible();
    // Source references and the unchecked-file notice stay in the draft, not on the review screen.
    await expect(page.getByText(/has not checked this JSON/)).toHaveCount(0);
    await expect(page.getByText(/^Source references/)).toHaveCount(0);
    await expect(page.getByText(/PDF page 3/)).toHaveCount(0);
    await expect(page.getByText(/Table row 4/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (info.project.name !== '1440px') {
      expect((await page.locator('.irev-uncertainty-confirm').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const accept = page.getByRole('button', { name: 'Accept and create program' });
    if (info.project.name !== '1440px') expect((await accept.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(accept).toBeDisabled();
    await page.getByRole('checkbox', { name: 'I reviewed these uncertain details.' }).check();
    await expect(accept).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`external-review-${theme}.png`), fullPage: true });
    const saved = page.waitForResponse(response => response.url().includes('/accept') && response.request().method() === 'POST');
    await accept.click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const program = await response.json();
    expect(program.sourceImportId).toBeNull();
    const programText = JSON.stringify(program);
    expect(programText).not.toContain('sourceReference');
    expect(programText).not.toContain('uncertainty');
    expect((await page.request.get(`/api/programs/${program.id}`)).ok()).toBe(true);
    await page.request.delete(`/api/programs/${program.id}`, { headers: requestHeaders });
  });
}

test('blocked clipboard exposes selectable prompt', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('blocked'); } } }));
  await page.goto('/import');
  await page.getByRole('button', { name: 'Copy prompt' }).click();
  await expect(page.getByText('Your browser blocked copying. Select and copy this text instead.')).toBeVisible();
  await expect(page.locator('.iep-manual textarea')).toHaveValue(/complete source/);
});

test('pasted and dropped JSON reach review, and a broken paste says where it breaks', async ({ page }) => {
  const valid = readFileSync(fixture('external-small.json'), 'utf8');
  await page.goto('/import');
  await page.getByRole('button', { name: 'Paste the JSON' }).click();
  const box = page.locator('.iep-paste-input');
  await box.fill('{"version":1,"program":{"name":"A","days":[');
  await page.getByRole('button', { name: 'Check pasted JSON' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /near line 1, column \d+/ })).toBeVisible();
  // The broken line is shown from the user's own text, with a marker under the column.
  await expect(page.locator('.iep-excerpt-code')).toContainText('"days":[');
  // A whole-file problem has no field to point at, so no bare path is shown.
  await expect(page.locator('.iep-error-path')).toHaveCount(0);
  await box.fill(valid);
  await page.getByRole('button', { name: 'Check pasted JSON' }).click();
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();

  await cleanDrafts(page);
  await page.reload();
  await expect(page.locator('.iep-panel')).toBeVisible();
  const dragged = (type: 'dragover' | 'drop') => page.evaluate(([kind, text]) => {
    const data = new DataTransfer();
    data.items.add(new File([text], 'dropped.json', { type: 'application/json' }));
    document.querySelector('.iep-panel')!.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: data }));
  }, [type, valid] as const);
  await dragged('dragover');
  // While a file is over the panel the drop zone says where it will land.
  await expect(page.locator('.iep-dropzone.is-active')).toContainText('Release to upload');
  await dragged('drop');
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
});

test('small and large valid files reach review', async ({ page }) => {
  await page.goto('/import');
  await page.route('**/api/imports/external', async route => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await route.continue();
  }, { times: 1 });
  const input = page.getByLabel('Program JSON file');
  await input.setInputFiles({ name: 'small-with-bom.json', mimeType: 'application/json',
    buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(fixture('external-small.json'))]) });
  await expect(page.getByRole('status').filter({ hasText: 'Checking the JSON file' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
  await cleanDrafts(page);
  await page.reload();
  const small = JSON.parse(readFileSync(fixture('external-small.json'), 'utf8'));
  small.program.name = 'Large external program';
  small.program.sourceWeekDays = 10;
  small.program.days = Array.from({ length: 280 }, (_, i) => ({ ...small.program.days[0], key: `day-${i}`, week: Math.floor(i / 10) + 1, name: `Day ${i + 1}` }));
  await page.getByLabel('Program JSON file').setInputFiles({ name: 'large-valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(small)) });
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible({ timeout: 120000 });
});
