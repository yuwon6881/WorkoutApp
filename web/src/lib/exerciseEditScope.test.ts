import { describe, expect, it } from 'vitest';
import type { DraftExercise, DraftSet, DraftWorkout, Exercise, ImportDraft } from '../types';
import {
  applyExerciseEdit,
  countOccurrences,
  describeChange,
  diffExercise,
  diffSets,
  findOccurrences
} from './exerciseEditScope';

const set = (patch: Partial<DraftSet> = {}): DraftSet => ({
  repMin: 8, repMax: 10, targetRpe: 8, restSeconds: null, tempo: null, loadText: null, notes: null,
  repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted', repsText: null, restText: null,
  rir: '2', warmup: false, ...patch
} as DraftSet);

const exercise = (lineId: string, sourceName: string, patch: Partial<DraftExercise> = {}): DraftExercise => ({
  lineId, sourceName, exerciseId: null, notes: null, sets: [set(), set(), set()], sequenceGroup: '',
  substitutions: [], restSeconds: 90, movementKey: sourceName.toLowerCase(), ...patch
});

const day = (lineId: string, blockId: string, exercises: DraftExercise[], patch: Partial<DraftWorkout> = {}): DraftWorkout => ({
  lineId, week: 1, name: lineId, focus: null, notes: null, exercises, block: blockId, phase: null,
  phaseWeek: 1, isRestDay: false, blockId, ...patch
});

const library = (id: string, name: string): Exercise => ({ id, name, aliases: [] } as unknown as Exercise);

// Two blocks, the bench press printed twice in block A and once in block B.
const draft = (): ImportDraft => ({
  programName: 'Program',
  workouts: [
    day('a1', 'A', [exercise('a1-bench', 'Bench Press'), exercise('a1-row', 'Row')]),
    day('a2', 'A', [exercise('a2-bench', 'Bench Press', { sets: [set({ rir: '3' }), set({ rir: '2' }), set({ rir: '1' })] })]),
    day('b1', 'B', [exercise('b1-bench', 'Bench Press')])
  ]
});

const lineIds = (items: { exercise: DraftExercise }[]) => items.map(item => item.exercise.lineId);
const find = (value: ImportDraft, lineId: string) =>
  value.workouts.flatMap(workout => workout.exercises).find(item => item.lineId === lineId)!;

describe('findOccurrences', () => {
  it('reaches the same movement in the same block, or in the whole program', () => {
    const base = find(draft(), 'a1-bench');

    expect(lineIds(findOccurrences(draft(), base, 'occurrence'))).toEqual([]);
    expect(lineIds(findOccurrences(draft(), base, 'block'))).toEqual(['a2-bench']);
    expect(lineIds(findOccurrences(draft(), base, 'program'))).toEqual(['a2-bench', 'b1-bench']);
    expect(countOccurrences(draft(), base)).toEqual({ block: 1, program: 2 });
  });

  it('reports nothing to apply to when the movement occurs once', () => {
    expect(countOccurrences(draft(), find(draft(), 'a1-row'))).toEqual({ block: 0, program: 0 });
  });

  it('matches a draft the server has not keyed yet by its written name', () => {
    const unkeyed = draft();
    for (const workout of unkeyed.workouts) for (const item of workout.exercises) delete item.movementKey;
    unkeyed.workouts[1].exercises[0].sourceName = 'BENCH  press';

    expect(lineIds(findOccurrences(unkeyed, find(unkeyed, 'a1-bench'), 'block'))).toEqual(['a2-bench']);
  });

  it('keeps matching the saved exercise after the edit renames it', () => {
    const base = find(draft(), 'a1-bench');
    const next = applyExerciseEdit(draft(), base, { ...base, sourceName: 'Flat Bench' }, 'block', []);

    expect(find(next, 'a2-bench').sourceName).toBe('Flat Bench');
    expect(find(next, 'b1-bench').sourceName).toBe('Bench Press');
  });
});

describe('applyExerciseEdit', () => {
  it('changes only the edited occurrence for the occurrence scope', () => {
    const base = find(draft(), 'a1-bench');
    const next = applyExerciseEdit(draft(), base, { ...base, restSeconds: 150 }, 'occurrence', []);

    expect(find(next, 'a1-bench').restSeconds).toBe(150);
    expect(find(next, 'a2-bench').restSeconds).toBe(90);
  });

  it('carries a rest or notes edit to the block but not to other blocks', () => {
    const base = find(draft(), 'a1-bench');
    const next = applyExerciseEdit(draft(), base, { ...base, restSeconds: 150, notes: 'Pause on the chest' }, 'block', []);

    expect(find(next, 'a2-bench')).toMatchObject({ restSeconds: 150, notes: 'Pause on the chest' });
    expect(find(next, 'b1-bench')).toMatchObject({ restSeconds: 90, notes: null });
  });

  it('carries it to every block for the program scope', () => {
    const base = find(draft(), 'a1-bench');
    const next = applyExerciseEdit(draft(), base, { ...base, restSeconds: 150 }, 'program', []);

    expect(find(next, 'b1-bench').restSeconds).toBe(150);
    expect(find(next, 'a1-row').restSeconds).toBe(90);
  });

  it('changes a field the edit left alone on no other occurrence', () => {
    const base = find(draft(), 'a1-bench');
    const other = draft();
    other.workouts[1].exercises[0].restSeconds = 60;
    other.workouts[1].exercises[0].notes = 'Their own cue';
    const next = applyExerciseEdit(other, base, { ...base, restSeconds: 150 }, 'block', []);

    expect(find(next, 'a2-bench').restSeconds).toBe(150);
    expect(find(next, 'a2-bench').notes).toBe('Their own cue');
  });

  it('patches only the changed set fields so each occurrence keeps its own RIR taper', () => {
    const base = find(draft(), 'a1-bench');
    const edited = { ...base, sets: base.sets.map((value, index) => index === 0 ? { ...value, repMin: 5, repMax: 6 } : value) };
    const next = applyExerciseEdit(draft(), base, edited, 'block', []);

    expect(find(next, 'a2-bench').sets.map(value => [value.repMin, value.repMax, value.rir]))
      .toEqual([[5, 6, '3'], [8, 10, '2'], [8, 10, '1']]);
  });

  it('adds a set to the other occurrences and removes the same one again', () => {
    const base = find(draft(), 'a1-bench');
    const added = applyExerciseEdit(draft(), base, { ...base, sets: [...base.sets, set({ repMin: 12, repMax: 15 })] }, 'block', []);
    expect(find(added, 'a2-bench').sets).toHaveLength(4);
    expect(find(added, 'a2-bench').sets[3]).toMatchObject({ repMin: 12, repMax: 15 });

    const removed = applyExerciseEdit(draft(), base, { ...base, sets: base.sets.slice(0, 2) }, 'block', []);
    expect(find(removed, 'a2-bench').sets.map(value => value.rir)).toEqual(['3', '2']);
  });

  it('removes the set that was actually deleted rather than the last one', () => {
    const base = find(draft(), 'a1-bench');
    const tapered = { ...base, sets: [set({ repMin: 5 }), set({ repMin: 6 }), set({ repMin: 7 })] };
    const target = draft();
    target.workouts[0].exercises[0] = tapered;
    target.workouts[1].exercises[0].sets = [set({ repMin: 5 }), set({ repMin: 6 }), set({ repMin: 7 })];

    const next = applyExerciseEdit(target, tapered, { ...tapered, sets: [tapered.sets[0], tapered.sets[2]] }, 'block', []);

    expect(find(next, 'a2-bench').sets.map(value => value.repMin)).toEqual([5, 7]);
  });

  it('swaps the library exercise in every reached occurrence and records the old one as a substitution', () => {
    const catalog = [library('bench', 'Bench Press'), library('incline', 'Incline Press')];
    const start = draft();
    for (const workout of start.workouts) for (const item of workout.exercises.filter(entry => entry.sourceName === 'Bench Press')) {
      item.exerciseId = 'bench';
      item.substitutions = ['Incline Press', 'Dip'];
    }
    const base = find(start, 'a1-bench');
    const edited = { ...base, exerciseId: 'incline', sourceName: 'Incline Press', substitutions: ['Bench Press', 'Dip'] };

    const next = applyExerciseEdit(start, base, edited, 'block', catalog);

    expect(find(next, 'a2-bench')).toMatchObject({ exerciseId: 'incline', sourceName: 'Incline Press', substitutions: ['Bench Press', 'Dip'] });
    expect(find(next, 'b1-bench')).toMatchObject({ exerciseId: 'bench', sourceName: 'Bench Press' });
  });

  it('keeps the written name when only the library exercise changes', () => {
    const base = find(draft(), 'a1-bench');
    const next = applyExerciseEdit(draft(), base, { ...base, exerciseId: 'bench' }, 'block', []);

    expect(find(next, 'a2-bench')).toMatchObject({ exerciseId: 'bench', sourceName: 'Bench Press' });
  });

  it('never grows a set list past the limit', () => {
    const base = find(draft(), 'a1-bench');
    const full = draft();
    full.workouts[1].exercises[0].sets = Array.from({ length: 24 }, () => set());

    const next = applyExerciseEdit(full, base, { ...base, sets: [...base.sets, set()] }, 'block', []);

    expect(find(next, 'a2-bench').sets).toHaveLength(24);
  });
});

describe('diffExercise', () => {
  it('has nothing to carry when only substitutions or the demo link changed', () => {
    const base = find(draft(), 'a1-bench');

    expect(diffExercise(base, { ...base, substitutions: ['Dip'], demoUrl: 'https://youtu.be/x' })).toBeNull();
  });

  it('names what changed in plain language', () => {
    const base = find(draft(), 'a1-bench');
    const change = diffExercise(base, { ...base, restSeconds: 120, notes: 'x', sets: base.sets.slice(1) });

    expect(describeChange(change!)).toEqual(['rest timer', 'notes', 'sets and reps']);
  });
});

describe('diffSets', () => {
  it('is null for identical sets', () => {
    expect(diffSets([set()], [set()])).toBeNull();
  });
});
