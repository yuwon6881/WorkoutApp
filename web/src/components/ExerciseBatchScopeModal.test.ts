import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DraftExercise } from '../types';
import type { PendingEdit } from '../lib/exerciseBatchEdit';
import { ExerciseBatchScopeModal } from './ExerciseBatchScopeModal';

const exercise = (lineId: string, sourceName: string): DraftExercise => ({
  lineId, sourceName, exerciseId: null, notes: null, sets: [], sequenceGroup: '', substitutions: [], restSeconds: 90
});
const pendingEdit = (name: string, counts: { block: number; program: number }, changes = ['rest timer']): PendingEdit =>
  ({ base: exercise(name, name), edited: exercise(name, name), changes, counts });
const render = (pending: PendingEdit[]) => renderToStaticMarkup(createElement(ExerciseBatchScopeModal, {
  pending, busy: false, error: null, onConfirm: () => {}, onCancel: () => {}
}));
const checkedValue = (markup: string) => markup.match(/value="(\w+)"[^>]*checked/)?.[1]
  ?? markup.match(/checked=""[^>]*value="(\w+)"/)?.[1];

describe('ExerciseBatchScopeModal', () => {
  it('asks once, defaulting to the same block, and counts what each wider choice reaches in total', () => {
    const markup = render([pendingEdit('Squat', { block: 2, program: 5 }), pendingEdit('Bench', { block: 1, program: 1 })]);

    expect(markup).toContain('Save changes to 2 exercises');
    expect(checkedValue(markup)).toBe('block');
    expect(markup).toContain('3 other occurrences');
    expect(markup).toContain('6 other occurrences');
    expect(markup).toContain('Save 2 exercises');
  });

  it('lists each exercise with what changed, and a reach of its own only where it has company', () => {
    const markup = render([
      pendingEdit('Squat', { block: 2, program: 5 }, ['sets and reps', 'notes']),
      pendingEdit('Deadlift', { block: 0, program: 0 })
    ]);

    expect(markup).toContain('sets and reps, notes');
    expect(markup).toContain('rest timer · this day only');
    expect(markup).toContain('Where to apply the changes to Squat');
    expect(markup).not.toContain('Where to apply the changes to Deadlift');
  });

  it('offers only the choices that would change something', () => {
    const blockIsProgram = render([pendingEdit('Squat', { block: 2, program: 2 }), pendingEdit('Row', { block: 0, program: 0 })]);
    expect(blockIsProgram).toContain('Same block');
    expect(blockIsProgram).not.toContain('Whole program');

    const programOnly = render([pendingEdit('Squat', { block: 0, program: 3 }), pendingEdit('Row', { block: 0, program: 0 })]);
    expect(checkedValue(programOnly)).toBe('occurrence');
    expect(programOnly).not.toContain('Same block');
    expect(programOnly).toContain('Whole program');
  });
});
