import { describe, expect, it } from 'vitest';
import type { DraftExercise, DraftSet, DraftWorkout, ImportDraft } from '../types';
import { countOccurrences, editableSnapshot, type UnsavedExercise } from './exerciseEditScope';
import { applyExerciseEdits, mergeEditedFields, needsReview, pendingEdits, reviewDefaultScope } from './exerciseBatchEdit';

const set = (patch: Partial<DraftSet> = {}): DraftSet => ({
  repMin: 8, repMax: 10, targetRpe: 8, restSeconds: null, tempo: null, loadText: null, notes: null,
  repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted', repsText: null, restText: null,
  rir: '2', warmup: false, ...patch
} as DraftSet);

const exercise = (lineId: string, sourceName: string, patch: Partial<DraftExercise> = {}): DraftExercise => ({
  lineId, sourceName, exerciseId: null, notes: null, sets: [set(), set(), set()], sequenceGroup: '',
  substitutions: [], restSeconds: 90, movementKey: sourceName.toLowerCase(), ...patch
});

const day = (lineId: string, blockId: string, exercises: DraftExercise[]): DraftWorkout => ({
  lineId, week: 1, name: lineId, focus: null, notes: null, exercises, block: blockId, phase: null,
  phaseWeek: 1, isRestDay: false, blockId
});

// Squat and bench each printed on day one and again on day two; deadlift only once.
const draft = (): ImportDraft => ({
  programName: 'Program',
  workouts: [
    day('d1', 'A', [exercise('d1-squat', 'Squat'), exercise('d1-bench', 'Bench Press'), exercise('d1-dead', 'Deadlift')]),
    day('d2', 'A', [exercise('d2-squat', 'Squat'), exercise('d2-bench', 'Bench Press')])
  ]
});

const find = (value: ImportDraft, lineId: string) =>
  value.workouts.flatMap(workout => workout.exercises).find(item => item.lineId === lineId)!;
const held = (saved: DraftExercise, patch: Partial<DraftExercise>): UnsavedExercise =>
  ({ base: editableSnapshot(saved), draft: { ...saved, ...patch } });
const edits = (value: ImportDraft, entries: [string, Partial<DraftExercise>][]) => {
  const unsaved = new Map(entries.map(([lineId, patch]) => [lineId, held(find(value, lineId), patch)]));
  return pendingEdits(value.workouts[0].exercises, unsaved, base => countOccurrences(value, base));
};

describe('mergeEditedFields', () => {
  it('takes the edited fields and keeps what changes outside the editor', () => {
    const saved = exercise('x', 'Squat', { sequenceGroup: 'A1' });
    const merged = mergeEditedFields(saved, { ...exercise('x', 'Front Squat', { restSeconds: 120 }), sequenceGroup: '' });
    expect(merged).toMatchObject({ sourceName: 'Front Squat', restSeconds: 120, sequenceGroup: 'A1' });
  });
});

describe('pendingEdits', () => {
  it('lists the held edits in day order with what changed and how far each could reach', () => {
    const value = draft();
    const pending = edits(value, [['d1-bench', { restSeconds: 150 }], ['d1-squat', { notes: 'Belt' }]]);

    expect(pending.map(item => item.base.lineId)).toEqual(['d1-squat', 'd1-bench']);
    expect(pending[0]).toMatchObject({ changes: ['notes'], counts: { block: 1, program: 1 } });
    expect(pending[1].changes).toEqual(['rest timer']);
  });

  it('leaves out an edit that no longer differs or was made from an exercise that has since changed', () => {
    const value = draft();
    const squat = find(value, 'd1-squat');
    const unsaved = new Map<string, UnsavedExercise>([
      ['d1-squat', held(squat, {})],
      ['d1-bench', { base: 'an older save', draft: { ...find(value, 'd1-bench'), restSeconds: 150 } }]
    ]);

    expect(pendingEdits(value.workouts[0].exercises, unsaved, () => ({ block: 0, program: 0 }))).toEqual([]);
  });
});

describe('applyExerciseEdits', () => {
  it('leaves passed occurrences untouched while applying the edit to other pending days', () => {
    const value = draft();
    value.workouts.push(day('d3', 'A', [exercise('d3-squat', 'Squat')]));
    const base = find(value, 'd1-squat');
    const lockedDayIds = new Set(['d2']);
    expect(countOccurrences(value, base, lockedDayIds)).toEqual({ block: 1, program: 1 });

    const next = applyExerciseEdits(value, [{ base, edited: { ...base, notes: 'Belt' }, scope: 'program' }], [], lockedDayIds);
    expect(find(next, 'd1-squat').notes).toBe('Belt');
    expect(next.workouts[1]).toBe(value.workouts[1]);
    expect(find(next, 'd3-squat').notes).toBe('Belt');
  });

  it('lands every edit in one pass, each with its own scope, without one undoing another', () => {
    const value = draft();
    const pending = edits(value, [['d1-squat', { restSeconds: 180 }], ['d1-bench', { notes: 'Pause' }], ['d1-dead', { restSeconds: 240 }]]);

    const next = applyExerciseEdits(value, pending.map(item => ({
      base: item.base, edited: item.edited,
      scope: item.base.lineId === 'd1-squat' ? 'block' : 'occurrence'
    })), []);

    expect(find(next, 'd1-squat').restSeconds).toBe(180);
    expect(find(next, 'd2-squat').restSeconds).toBe(180);
    expect(find(next, 'd1-bench').notes).toBe('Pause');
    expect(find(next, 'd2-bench').notes).toBeNull();
    expect(find(next, 'd1-dead').restSeconds).toBe(240);
  });
});

describe('the review', () => {
  it('is needed only when some edit could reach another occurrence', () => {
    const value = draft();
    expect(needsReview(edits(value, [['d1-dead', { restSeconds: 240 }]]))).toBe(false);
    expect(needsReview(edits(value, [['d1-dead', { restSeconds: 240 }], ['d1-bench', { restSeconds: 150 }]]))).toBe(true);
  });

  it('defaults to the same block when any edit has company there', () => {
    const value = draft();
    expect(reviewDefaultScope(edits(value, [['d1-bench', { restSeconds: 150 }]]))).toBe('block');
    expect(reviewDefaultScope(edits(value, [['d1-dead', { restSeconds: 240 }]]))).toBe('occurrence');
  });
});
