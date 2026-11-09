import { describe, expect, it } from 'vitest';
import type { DraftExercise, DraftSet, Exercise, ImportDraft } from '../types';
import { applyImportOption, optionLabel, optionsAt } from './importOptions';

const set = (patch: Partial<DraftSet> = {}) => ({ repMin: 8, repMax: 10, targetRpe: 8, warmup: false, ...patch }) as DraftSet;
const exercise = (lineId: string, patch: Partial<DraftExercise> = {}) =>
  ({ lineId, sourceName: 'HEX BAR', exerciseId: null, notes: null, sets: [set()], sequenceGroup: '', substitutions: [], ...patch }) as DraftExercise;
const draftOf = (...exercises: DraftExercise[]) => ({
  programName: 'P',
  workouts: exercises.map((item, index) => ({ lineId: `d${index}`, week: 1, name: `Day ${index}`, exercises: [item] }))
}) as unknown as ImportDraft;
const library = [{ id: 'shrug', name: 'Hex-bar shrug' }, { id: 'dead', name: 'Hex-bar deadlift' }] as Exercise[];
const flagged = (options: object[]) => ({ flag: true, reason: 'Name cut off', options }) as DraftExercise['uncertainty'];

describe('import options', () => {
  it('lists the options of a flagged exercise and of a flagged set', () => {
    const exerciseOptions = [{ label: 'Shrug', exerciseId: 'shrug' }];
    const setOptions = [{ label: '21 reps', repMin: 21, repMax: 21 }];
    const draft = draftOf(exercise('a', { uncertainty: flagged(exerciseOptions), sets: [set({ uncertainty: { flag: true, options: setOptions } })] }));
    expect(optionsAt(draft, { workoutLineId: 'd0', exerciseLineId: 'a' })).toEqual(exerciseOptions);
    expect(optionsAt(draft, { workoutLineId: 'd0', exerciseLineId: 'a', setIndex: 0 })).toEqual(setOptions);
    expect(optionsAt(draft, { workoutLineId: 'd0', exerciseLineId: 'missing' })).toEqual([]);
  });

  it('names a movement option by its library name and any other option by its label', () => {
    expect(optionLabel({ label: 'Shrug?', exerciseId: 'shrug' }, library)).toBe('Hex-bar shrug');
    expect(optionLabel({ label: '21 reps', repMin: 21, repMax: 21 }, library)).toBe('21 reps');
  });

  it('maps every occurrence of the written movement and settles the flags the choice answers', () => {
    const options = [{ label: 'Shrug', exerciseId: 'shrug' }, { label: 'Deadlift', exerciseId: 'dead' }];
    const draft = draftOf(exercise('a', { uncertainty: flagged(options) }), exercise('b', { uncertainty: flagged(options) }),
      exercise('c', { sourceName: 'Bench press' }));
    const next = applyImportOption(draft, { workoutLineId: 'd0', exerciseLineId: 'a' }, options[0], library)!;
    const [a, b, c] = next.workouts.map(day => day.exercises[0]);
    expect([a.exerciseId, b.exerciseId, c.exerciseId]).toEqual(['shrug', 'shrug', null]);
    expect(a.uncertainty).toEqual({ flag: false, reason: 'Name cut off' });
    expect(b.uncertainty?.flag).toBe(false);
  });

  it('applies the reps and effort of a set option to that set only', () => {
    const options = [{ label: '21 reps', repMin: 21, repMax: 21 }, { label: 'RPE 9', targetRpe: 9 }];
    const draft = draftOf(exercise('a', { sets: [set({ uncertainty: { flag: true, reason: 'Conflict', options } }), set()] }));
    const reps = applyImportOption(draft, { workoutLineId: 'd0', exerciseLineId: 'a', setIndex: 0 }, options[0], library)!;
    const [first, second] = reps.workouts[0].exercises[0].sets;
    expect([first.repMin, first.repMax, first.targetRpe]).toEqual([21, 21, 8]);
    expect(first.uncertainty).toEqual({ flag: false, reason: 'Conflict' });
    expect(second.repMin).toBe(8);
    const effort = applyImportOption(draft, { workoutLineId: 'd0', exerciseLineId: 'a', setIndex: 0 }, options[1], library)!;
    expect(effort.workouts[0].exercises[0].sets[0].targetRpe).toBe(9);
    expect(effort.workouts[0].exercises[0].sets[0].repMin).toBe(8);
  });

  it('does nothing for an option that cannot be applied', () => {
    const draft = draftOf(exercise('a'));
    expect(applyImportOption(draft, { workoutLineId: 'd0', exerciseLineId: 'a' }, { label: 'No id' }, library)).toBeNull();
    expect(applyImportOption(draft, { workoutLineId: 'd0', exerciseLineId: 'gone' }, { label: 'x', exerciseId: 'shrug' }, library)).toBeNull();
  });
});
