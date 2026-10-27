import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import type { DraftSet, Exercise, ImportDraft, ImportView } from '../src/types';
import { applySetType, type SetType } from '../src/lib/importSetTypes';
import { ensureStructureIds } from '../src/lib/importDraftWeeks';
import { signIn } from './signIn';

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

const set = (type: SetType = 'normal', reps = 8): DraftSet => {
  const base: DraftSet = { repMin: reps, repMax: reps, targetRpe: 8, rir: '2', warmup: false,
    restSeconds: 90, tempo: null, loadText: null, notes: null, repsText: null, restText: null,
    repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' };
  return { ...base, ...applySetType(base, type) };
};
const catalog: Exercise[] = [
  { id: 'squat', slug: 'back-squat', name: 'Back Squat', muscle: 'Quads', secondaryMuscles: ['Glutes', 'Hamstrings'],
    equipment: 'Barbell', aliases: [], loadStepKg: 2.5, trackingMode: 'reps' },
  { id: 'pinch', slug: 'plate-pinch', name: 'Plate Pinch', muscle: 'Forearms', equipment: 'Plate', aliases: [], loadStepKg: 1, trackingMode: 'duration' }
];
const names = ['BACK SQUAT', 'BARBELL BENCH PRESS', 'WIDE-GRIP LAT PULLDOWN', 'SLIDING LEG CURL', 'PLATE PINCH'];
const draft: ImportDraft = ensureStructureIds({ programName: 'Powerbuilding review layout', workouts: Array.from({ length: 12 }, (_, week) => ({
  lineId: `day-${week}`, week: week + 1, name: 'Full Body 1', focus: null, notes: null,
  block: null, phase: null, phaseWeek: week + 1, isRestDay: false,
  exercises: names.map((sourceName, index) => ({ lineId: `exercise-${week}-${index}`, sourceName,
    exerciseId: index === 0 ? 'squat' : index === 4 ? 'pinch' : null, notes: index === 0 ? 'Maintain pressure through the full range.' : null,
    sequenceGroup: '', substitutions: [], restSeconds: 210,
    sets: index === 0 ? (['warmup', 'normal', 'dropset', 'myoreps', 'partials', 'lengthenedPartials', 'integratedPartials'] as SetType[]).map(type => set(type))
      : [set('normal', index === 4 ? 45 : 8)] }))
})) });

for (const theme of ['dark', 'light']) {
  test(`import review geometry and editing in ${theme}`, async ({ page }, info) => {
    await signIn(page, 'e2e-responsive');
    const launch = await (await page.request.get('/api/bootstrap/launch')).json();
    let view: ImportView = { id: '00000000-0000-4000-8000-000000000091', status: 'ready', stage: 'done',
      fileName: 'Powerbuilding review.pdf', pages: 48, error: '', created: '2026-10-14T00:00:00Z', model: 'layout-fixture',
      chunksDone: 12, chunksTotal: 12, currentChunkLabel: null, unresolvedCount: 0, draft, unresolved: [],
      acceptable: true, programId: null, reviewIssues: [], revision: 1 };
    launch.activeWorkout = null;
    launch.preferences = { ...launch.preferences, theme, trackRir: true };
    await page.route('**/api/bootstrap/launch', route => route.fulfill({ json: { ...launch, imports: [view] } }));
    await page.route('**/api/exercises', route => route.fulfill({ json: catalog }));
    await page.route('**/api/imports', route => route.fulfill({ json: [view] }));
    await page.route(`**/api/imports/${view.id}`, route => route.fulfill({ json: view }));
    await page.route(`**/api/imports/${view.id}/**`, route => route.fulfill({ json: view }));
    await page.goto('/import');
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const badge = page.locator('.pdl-day-badge').first();
    expect((await badge.boundingBox())!.height).toBeGreaterThanOrEqual(52);
    await expect(page.locator('.pdl-preview-name').first()).toHaveCSS('font-weight', '400');
    // A day's exercise names stay on one line at every width, with the rest counted.
    const previews = await page.locator('.pdl-exercise-preview').filter({ visible: true }).evaluateAll(elements => elements.map(element => {
      const row = element.querySelector('.pdl-preview-row')!;
      const name = row.querySelector('.pdl-preview-name')!;
      const shown = row.querySelectorAll('.pdl-preview-name').length;
      const more = row.querySelector('.pdl-preview-more')?.textContent ?? '';
      return { height: row.getBoundingClientRect().height, line: name.getBoundingClientRect().height,
        overflows: row.scrollWidth > row.clientWidth + 1, shown, more };
    }));
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview.height, JSON.stringify(preview)).toBeLessThanOrEqual(preview.line + 1);
      expect(preview.overflows, JSON.stringify(preview)).toBe(false);
      if (preview.shown < names.length) expect(preview.more).toBe(`+${names.length - preview.shown} more`);
    }
    await expect(page.locator('.ptl-icon-tile')).toHaveCSS('box-shadow', 'none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`timeline-${theme}.png`), fullPage: true });
    await page.locator('.draft-day-summary').first().click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('.day-detail-modal-body') });
    await expect(dialog).toBeVisible();
    const first = dialog.locator('.import-exercise').first();
    const badges = first.locator('.iex-muscle-badges');
    const library = first.locator('.iex-library-field');
    const badgeBounds = (await badges.boundingBox())!;
    const libraryBounds = (await library.boundingBox())!;
    expect(Math.abs(badgeBounds.x - libraryBounds.x)).toBeLessThan(1);
    expect(badgeBounds.y).toBeGreaterThan(libraryBounds.y);
    const widths = await dialog.locator('.iex-set-row input[type="number"]').filter({ visible: true }).evaluateAll(inputs => inputs.map(input => input.getBoundingClientRect().width));
    const geometry = await dialog.locator('.iex-set-row input[type="number"]').filter({ visible: true }).evaluateAll(inputs => inputs.map(input => ({
      name: input.getAttribute('name'), width: input.getBoundingClientRect().width,
      wrapper: input.parentElement!.getBoundingClientRect().width,
      field: input.closest('.rep-prescription-field')!.getBoundingClientRect().width
    })));
    writeFileSync(info.outputPath('numeric-geometry.json'), JSON.stringify(geometry, null, 2));
    await page.screenshot({ path: info.outputPath(`day-${theme}.png`) });
    expect(Math.max(...widths) - Math.min(...widths), 'reps, time, warm-ups and techniques share numeric sizes').toBeLessThan(1);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(44);
    const types = await first.locator('.set-type-select .custom-select-trigger').filter({ visible: true }).evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
    expect(Math.max(...types) - Math.min(...types)).toBeLessThan(1);
    const mode = first.getByRole('group', { name: 'Rep target for BACK SQUAT', exact: true });
    await mode.getByRole('button', { name: 'Range', exact: true }).click();
    const max = first.getByRole('spinbutton', { name: 'BACK SQUAT set 1 max reps', exact: true });
    const remembered = await max.inputValue();
    await mode.getByRole('button', { name: 'Exact', exact: true }).click();
    await mode.getByRole('button', { name: 'Range', exact: true }).click();
    await expect(max).toHaveValue(remembered);
    const rangeWidths = await first.locator('.rep-range-inputs input').filter({ visible: true }).evaluateAll(inputs => inputs.map(input => input.getBoundingClientRect().width));
    expect(rangeWidths.every(width => Math.abs(width - widths[0]) < 1)).toBe(true);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await first.locator('.iex-prescription-toolbar').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`prescriptions-${theme}.png`) });
    await first.locator('.iex-save-bar').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(first.locator('.iex-save-bar')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();

    // Sections are read side by side and none has committed yet: the bar and the tiles still move.
    const sectionStates = ['saved', 'saved', 'saved', 'checking', 'repairing', 'reading', 'reading', 'reading', 'reading', 'queued', 'queued', 'queued'];
    view = { ...view, status: 'pending', stage: 'extract', draft: null, chunksDone: 0,
      progress: { sectionsCompleted: 0, sectionsQueued: 3, sectionsReading: 4, sectionsVerifying: 1, sectionsRepairing: 1,
        sectionsWithResponses: 5, startedAtUtc: new Date(Date.now() - 75_000).toISOString(), lastProgressAtUtc: new Date().toISOString(), sectionStates } };
    await page.reload();
    const progress = page.locator('.ipc-progress-track');
    await expect(progress).toBeVisible();
    await expect(progress).toHaveCSS('height', '4px');
    await expect(page.locator('.ipc-section')).toHaveCount(sectionStates.length);
    await expect(page.locator('.ipc-section--reading')).toHaveCount(4);
    expect(Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(30);
    await expect(page.locator('.ipc-elapsed')).toHaveText(/^1:1\d$/);
    await expect(page.locator('.ipc-stat-chip--accent')).toContainText('3done');
    const progressCard = page.locator('.ipc-card');
    const bounds = (await progressCard.boundingBox())!;
    const contents = await progressCard.locator(':scope > *').filter({ visible: true }).evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }));
    await page.screenshot({ path: info.outputPath(`progress-${theme}.png`), fullPage: true });
    expect(contents.every(rect => rect.left >= bounds.x && rect.right <= bounds.x + bounds.width), JSON.stringify({ bounds, contents })).toBe(true);
    expect(await progressCard.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}
