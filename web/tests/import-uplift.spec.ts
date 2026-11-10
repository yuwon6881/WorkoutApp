import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
    equipment: 'Barbell', aliases: [], loadStepKg: 2.5, trackingMode: 'reps', requires: ['rack'] },
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
      fileName: 'Powerbuilding review.json', pages: 0, error: '', created: '2026-10-14T00:00:00Z', model: 'external',
      unresolvedCount: 0, draft, unresolved: [],
      acceptable: true, programId: null, reviewIssues: [
        { code: 'external_uncertainty', message: 'BACK SQUAT: Working sets are printed as a range (1-3); used the lowest set count (1)', severity: 'info', sourcePage: 3, workoutLineId: 'day-0', exerciseLineId: 'exercise-0-0' },
        { code: 'external_uncertainty', message: 'BACK SQUAT: Check the movement', severity: 'info', sourcePage: 3, workoutLineId: 'day-0', exerciseLineId: 'exercise-0-0' },
        { code: 'external_uncertainty', message: 'BACK SQUAT, set 2: Check reps', severity: 'info', sourcePage: 3, workoutLineId: 'day-0', exerciseLineId: 'exercise-0-0', setIndex: 1 },
        { code: 'external_uncertainty', message: 'Check the set count', severity: 'info' }
      ], revision: 1 };
    launch.activeWorkout = null;
    launch.exercises = catalog;
    launch.gym = { active: { id: 'gym', name: 'Lalaport', active: true, revision: 1,
      missingEquipment: ['rack'], exerciseOverrides: {} }, profiles: [{ id: 'gym', name: 'Lalaport' }],
      missingLabels: { rack: 'Rack' } };
    launch.preferences = { ...launch.preferences, theme, trackRir: true };
    await page.route('**/api/bootstrap/launch', route => route.fulfill({ json: { ...launch, imports: [view] } }));
    await page.route('**/api/exercises', route => route.fulfill({ json: catalog }));
    await page.route('**/api/imports', route => route.fulfill({ json: [view] }));
    await page.route(`**/api/imports/${view.id}`, route => route.fulfill({ json: view }));
    await page.route(`**/api/imports/${view.id}/**`, route => route.fulfill({ json: view }));
    await page.goto('/import');
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
    await expect(page.getByText('Check the set count')).toBeVisible();
    await expect(page.getByText('Review needed', { exact: true })).toBeVisible();
    const acknowledge = page.getByRole('checkbox', { name: 'I reviewed these uncertain details.' });
    await expect(page.getByRole('button', { name: 'Accept and create program' })).toBeDisabled();
    const screenshotDir = resolve('..', 'artifacts', 'uncertainty-ui-screenshots');
    mkdirSync(screenshotDir, { recursive: true });
    await page.evaluate(() => { document.querySelector('.irev-uncertainty')?.scrollIntoView({ block: 'center' }); });
    await page.locator('.irev-uncertainty').screenshot({ path: join(screenshotDir, `${info.project.name}-uncertainty-unconfirmed-${theme}.png`) });
    await page.locator('.irev-panel').screenshot({ path: join(screenshotDir, `${info.project.name}-review-panel-unconfirmed-${theme}.png`) });

    // Inspect working sets range -> opens Day modal and highlights set prescriptions, not rest timer
    await page.getByRole('button', { name: /Inspect BACK SQUAT: Working sets/i }).click();
    const dayModal = page.getByRole('dialog').filter({ has: page.locator('.day-detail-modal-body') });
    await expect(dayModal).toBeVisible();
    const setsList = dayModal.locator('[data-import-field="sets"]').first();
    await expect(setsList).toHaveClass(/issue-focus/);
    const restField = dayModal.locator('[data-import-field="rest"]').first();
    await expect(restField).not.toHaveClass(/issue-focus/);
    await expect(setsList).toBeInViewport();
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(screenshotDir, `${info.project.name}-inspect-sets-${theme}.png`) });
    await dayModal.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(dayModal).toBeHidden();

    // Inspect exercise movement -> opens Day modal and highlights exercise card, not rest timer
    await page.getByRole('button', { name: /Inspect BACK SQUAT: Check the movement/i }).click();
    await expect(dayModal).toBeVisible();
    const exerciseCard = dayModal.locator('[data-import-exercise="exercise-0-0"]');
    await expect(exerciseCard).toHaveClass(/issue-focus/);
    await expect(restField).not.toHaveClass(/issue-focus/);
    await expect(exerciseCard).toBeInViewport();
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(screenshotDir, `${info.project.name}-inspect-exercise-${theme}.png`) });
    await dayModal.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(dayModal).toBeHidden();

    await acknowledge.check();
    await page.evaluate(() => { document.querySelector('.irev-uncertainty')?.scrollIntoView({ block: 'center' }); });
    await page.locator('.irev-uncertainty').screenshot({ path: join(screenshotDir, `${info.project.name}-uncertainty-confirmed-${theme}.png`) });
    await page.locator('.irev-panel').screenshot({ path: join(screenshotDir, `${info.project.name}-review-panel-confirmed-${theme}.png`) });
    await expect(page.getByText('Ready to create', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept and create program' })).toBeEnabled();
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
    await expect(page.getByText('Lalaport', { exact: true })).toBeVisible();
    await expect(page.getByText('Missing: Rack')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace BACK SQUAT' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Full Body 1', exact: true }).first().click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('.day-detail-modal-body') });
    await expect(dialog).toBeVisible();
    const first = dialog.locator('.import-exercise').first();
    await expect(first.locator('.iex-name')).toHaveText('Back Squat');
    await expect(first.getByRole('textbox', { name: 'Exercise name' })).toHaveCount(0);
    const badges = first.locator('.iex-muscle-badges');
    const library = first.locator('.iex-library-field');
    await library.getByRole('button').click();
    const picker = page.getByRole('dialog', { name: 'Choose exercise for BACK SQUAT' });
    await expect(picker).toBeVisible();
    await picker.getByRole('textbox', { name: 'Search exercises' }).fill('Plate Pinch');
    await expect(picker.getByRole('button', { name: 'Swap Plate Pinch' })).toBeVisible();
    await picker.getByRole('button', { name: 'Done', exact: true }).click();
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
  });
}
