import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ImportDraft, ImportView } from '../types';
import { GymAvailabilityContext } from '../lib/gymAvailability';
import { ImportReviewPanel, resolveUncertaintyTargetField } from './ImportReviewPanel';

describe('import gym review', () => {
  it('keeps source references and the unchecked-file notice out of the review', () => {
    const draft = { programName: 'Plan', workouts: [{ lineId: 'd', name: 'Day one',
      sourceReference: { kind: 'sheetCell', sheet: 'Plan', cell: 'A1:B2' },
      exercises: [{ lineId: 'e', sourceName: 'Squat', exerciseId: null,
        sourceReference: { kind: 'pdfPage', page: 3 },
        sets: [{ sourceReference: { kind: 'text', text: 'Table row 4' } }] }] }] } as unknown as ImportDraft;
    const view = { unresolved: [], acceptable: true, reviewIssues: [{ code: 'external_source_unverified', severity: 'info' }] } as unknown as ImportView;
    const html = renderToStaticMarkup(createElement(ImportReviewPanel, { view, draft, attentionRows: [],
      onNameChange: () => {}, onNameCommit: () => {}, onFocusIssue: () => {} }));
    expect(html).toContain('Plan');
    expect(html).not.toContain('A1:B2');
    expect(html).not.toContain('page 3');
    expect(html).not.toContain('Table row 4');
    expect(html).not.toContain('Source references');
    expect(html).not.toContain('has not checked');
  });
  it('shows uncertain details and an unchecked acknowledgement', () => {
    const draft = { programName: 'Plan', workouts: [] } as unknown as ImportDraft;
    const view = { unresolved: [], acceptable: true, reviewIssues: [
      { code: 'external_uncertainty', message: 'Check the set count', severity: 'info' }
    ] } as unknown as ImportView;
    const html = renderToStaticMarkup(createElement(ImportReviewPanel, { view, draft, attentionRows: [],
      onNameChange: () => {}, onNameCommit: () => {}, onFocusIssue: () => {},
      acknowledgedUncertainty: false, onAcknowledgeUncertainty: () => {} }));
    expect(html).toContain('Check the set count');
    expect(html).toContain('Review needed');
    expect(html).toContain('I reviewed these uncertain details');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
  });
  it('prevents acknowledging uncertain details while the draft is still changing', () => {
    const draft = { programName: 'Plan', workouts: [] } as unknown as ImportDraft;
    const view = { unresolved: [], acceptable: true, reviewIssues: [
      { code: 'external_uncertainty', message: 'Check the set count', severity: 'info' }
    ] } as unknown as ImportView;
    const html = renderToStaticMarkup(createElement(ImportReviewPanel, { view, draft, attentionRows: [], busy: true,
      onNameChange: () => {}, onNameCommit: () => {}, onFocusIssue: () => {}, onAcknowledgeUncertainty: () => {} }));
    expect(html).toContain('disabled=""');
  });
  it('lists each unavailable movement group once and identifies the gym', () => {
    const movement = (lineId: string, sourceName: string) => ({ lineId, sourceName, exerciseId: 'squat', sets: [] });
    const draft = { programName: 'Plan', workouts: [
      { lineId: 'day1', exercises: [movement('one', 'Squat'), movement('two', 'Squat')] },
      { lineId: 'day2', exercises: [movement('three', 'Paused squat')] }
    ] } as unknown as ImportDraft;
    const view = { unresolved: [], acceptable: true } as unknown as ImportView;
    const html = renderToStaticMarkup(createElement(GymAvailabilityContext.Provider, {
      value: { gym: { active: { id: 'gym', name: 'Lalaport', active: true, revision: 1,
        missingEquipment: ['rack'], exerciseOverrides: {} }, profiles: [{ id: 'gym', name: 'Lalaport' }],
        missingLabels: { rack: 'Rack' } }, requires: new Map([['squat', ['rack']]]) }
    }, createElement(ImportReviewPanel, { view, draft, attentionRows: [], onNameChange: () => {},
      onNameCommit: () => {}, onFocusIssue: () => {} })));
    expect(html).toContain('2 movements are unavailable');
    expect(html).toContain('<strong>Lalaport</strong>');
    expect(html).not.toContain('Replace Squat');
    expect(html).not.toContain('Replace Paused squat');
    expect(html).toContain('Squat');
    expect(html).toContain('Paused squat');
    expect(html).toContain('Missing: Rack');
  });
  it('formats uncertain details with title, reason, page pill, inspect button, and reviewed status', () => {
    const draft = { programName: 'Plan', workouts: [] } as unknown as ImportDraft;
    const view = { unresolved: [], acceptable: true, reviewIssues: [
      {
        code: 'external_uncertainty',
        message: 'Barbell bench press: Check the movement',
        severity: 'info',
        sourcePage: 3,
        workoutLineId: 'w1',
        exerciseLineId: 'e1'
      }
    ] } as unknown as ImportView;
    const html = renderToStaticMarkup(createElement(ImportReviewPanel, {
      view, draft, attentionRows: [],
      onNameChange: () => {}, onNameCommit: () => {}, onFocusIssue: () => {},
      acknowledgedUncertainty: true, onAcknowledgeUncertainty: () => {}
    }));
    expect(html).toContain('Barbell bench press');
    expect(html).toContain('Check the movement');
    expect(html).toContain('p.3');
    expect(html).toContain('Inspect');
    expect(html).toContain('Reviewed');
    expect(html).toContain('is-confirmed');
  });

  it('resolves uncertainty targetField accurately for sets, reps, rest, and cards', () => {
    // Set count or working sets message -> targets 'sets'
    expect(resolveUncertaintyTargetField({
      message: 'BACK SQUAT: Working sets are printed as a range (1-3); used the lowest set count (1)'
    })).toBe('sets');
    expect(resolveUncertaintyTargetField({
      message: 'Check the set count'
    })).toBe('sets');
    expect(resolveUncertaintyTargetField({
      message: 'BARBELL ROW: 4 sets prescribed across two sessions'
    })).toBe('sets');

    // General exercise uncertainty -> undefined (targets exercise card)
    expect(resolveUncertaintyTargetField({
      message: 'BACK SQUAT: Check the movement'
    })).toBeUndefined();
    expect(resolveUncertaintyTargetField({
      message: 'BARBELL BENCH PRESS: Alternative exercise selected'
    })).toBeUndefined();

    // Set-level uncertainty targeting specific fields
    expect(resolveUncertaintyTargetField({
      message: 'BACK SQUAT, set 2: Check reps',
      setIndex: 1
    })).toBe('repMin');
    expect(resolveUncertaintyTargetField({
      message: 'BACK SQUAT, set 2: Target RPE 8 was assumed',
      setIndex: 1
    })).toBe('targetRpe');
    expect(resolveUncertaintyTargetField({
      message: 'BACK SQUAT, set 2: Check rest timer',
      setIndex: 1
    })).toBe('rest');

    // Set-level uncertainty without specific field -> undefined (targets set row)
    expect(resolveUncertaintyTargetField({
      message: 'BACK SQUAT, set 2: Review technique notes',
      setIndex: 1
    })).toBeUndefined();

    // Explicit targetField preserved
    expect(resolveUncertaintyTargetField({
      message: 'Check movement',
      targetField: 'library'
    })).toBe('library');
  });
});

describe("import uncertain details with suggested answers", () => {
  const draft = { programName: "Plan", workouts: [{ lineId: "d", name: "Day one", exercises: [{ lineId: "e", sourceName: "HEX BAR", exerciseId: null, sets: [],
    uncertainty: { flag: true, reason: "Name cut off", options: [{ label: "Shrug", exerciseId: "x1" }, { label: "Deadlift", exerciseId: "x2" }] } }] }] } as unknown as ImportDraft;
  const view = { unresolved: [], acceptable: true, reviewIssues: [
    { code: "external_uncertainty", message: "HEX BAR: Name cut off", severity: "info", workoutLineId: "d", exerciseLineId: "e" }
  ] } as unknown as ImportView;
  const render = (extra: object) => renderToStaticMarkup(createElement(ImportReviewPanel, { view, draft, attentionRows: [],
    onNameChange: () => {}, onNameCommit: () => {}, onFocusIssue: () => {}, ...extra }));

  it("offers each option by its library name next to Inspect", () => {
    const html = render({ exercises: [{ id: "x1", name: "Hex-bar shrug" }, { id: "x2", name: "Hex-bar deadlift" }], onApplyOption: () => {} });
    expect(html).toContain("Suggested answers");
    expect(html).toContain("Hex-bar shrug");
    expect(html).toContain("Hex-bar deadlift");
    expect(html).toContain("Inspect");
  });

  it("shows no answers when the assistant offered none or nothing can apply them", () => {
    expect(render({ exercises: [] })).not.toContain("Suggested answers");
  });
});
