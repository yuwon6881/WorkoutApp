import { describe, expect, it } from 'vitest';
import type { DraftExercise, DraftSet, DraftWorkout, ImportDraft, Session, SessionExercise, SetPrescription } from '../types';
import { changedDayIds, toDraftSet } from './activeSlot';
import { applyFinishPlan, finishPlanEdits, mayHavePlanEdits } from './finishPlanUpdate';

const prescription = (patch: Partial<SetPrescription> = {}): SetPrescription => ({
  repMin: 8, repMax: 10, targetRpe: null, restSeconds: 120, tempo: null, loadText: null, notes: null,
  repsText: null, restText: null, rir: '2', warmup: false, repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted',
  resistanceMode: 'external', sourcePage: null, ...patch
});
const set = (patch: Partial<SetPrescription> = {}): DraftSet => toDraftSet(prescription(patch));

const exercise = (lineId: string, sourceName: string, patch: Partial<DraftExercise> = {}): DraftExercise => ({
  lineId, sourceName, exerciseId: `${sourceName}-id`, notes: null, sets: [set(), set()], sequenceGroup: '',
  substitutions: [], restSeconds: 120, ...patch
});

const day = (lineId: string, block: string, exercises: DraftExercise[]): DraftWorkout => ({
  lineId, week: 1, name: lineId, focus: null, notes: null, exercises, block, phase: null, phaseWeek: 1, isRestDay: false
});

// Bench press on two days of block A and once in block B; the row appears once.
const program = (): ImportDraft => ({
  programName: 'Program',
  workouts: [
    day('a1', 'A', [exercise('a1-bench', 'Bench Press'), exercise('a1-row', 'Row')]),
    day('a2', 'A', [exercise('a2-bench', 'Bench Press', { sets: [set({ rir: '3' }), set({ rir: '1' })] })]),
    day('b1', 'B', [exercise('b1-bench', 'Bench Press')])
  ]
});

const sessionExercise = (sourceTemplateExerciseId: string, name: string, patch: Partial<SessionExercise> = {}): SessionExercise => ({
  id: `session-${sourceTemplateExerciseId}`, exerciseId: `${name}-id`, name, position: 0, note: '',
  prescription: [prescription(), prescription()], sets: [], sequenceGroup: '', substitutions: [], progression: null,
  sourceTemplateExerciseId, restSeconds: 120, canRestore: false, ...patch
});

const session = (exercises: SessionExercise[], programId: string | null = 'program'): Session => ({
  id: 'session', templateId: 'a1', programId, name: 'a1', note: '', active: true, startedAt: '2026-10-04T08:00:00Z',
  finishedAt: null, revision: 3, exercises, volumeKg: null, completedSets: 0, warmupSets: 0
});

const find = (draft: ImportDraft, lineId: string) =>
  draft.workouts.flatMap(workout => workout.exercises).find(item => item.lineId === lineId)!;

describe('mayHavePlanEdits', () => {
  it('looks at the program only for a program workout whose plan changed or was swapped', () => {
    expect(mayHavePlanEdits(session([sessionExercise('a1-bench', 'Bench Press')]))).toBe(false);
    expect(mayHavePlanEdits(session([sessionExercise('a1-bench', 'Bench Press', { canRestore: true })]))).toBe(true);
    expect(mayHavePlanEdits(session([sessionExercise('a1-bench', 'Bench Press', { isReplacement: true })]))).toBe(true);
    expect(mayHavePlanEdits(session([sessionExercise('a1-bench', 'Bench Press', { canRestore: true })], null))).toBe(false);
  });
});

describe('finishPlanEdits', () => {
  it('finds a changed set list and how far the same movement reaches', () => {
    const changed = sessionExercise('a1-bench', 'Bench Press', {
      canRestore: true, prescription: [prescription(), prescription(), prescription()]
    });

    const summary = finishPlanEdits(session([changed, sessionExercise('a1-row', 'Row')]), program());

    expect(summary.edits.map(edit => edit.base.lineId)).toEqual(['a1-bench']);
    expect(summary.counts).toEqual({ block: 1, program: 2 });
    expect(summary.changes).toEqual(['sets and reps']);
  });

  it('reports nothing when the workout matches its program', () => {
    expect(finishPlanEdits(session([sessionExercise('a1-bench', 'Bench Press')]), program()).edits).toEqual([]);
  });

  it('does not read a catalog display name as a renamed exercise', () => {
    const shown = sessionExercise('a1-bench', 'Barbell Bench Press', { exerciseId: 'Bench Press-id' });
    expect(finishPlanEdits(session([shown]), program()).edits).toEqual([]);
  });

  it('carries a swap as a library change under the swapped name', () => {
    const swapped = sessionExercise('a1-bench', 'Dumbbell Press', { isReplacement: true, exerciseId: 'db-press' });

    const [edit] = finishPlanEdits(session([swapped]), program()).edits;

    expect(edit.change.library).toEqual({ exerciseId: 'db-press', sourceName: 'Dumbbell Press', viaSubstitution: false });
  });
});

describe('applyFinishPlan', () => {
  const addedSet = () => finishPlanEdits(session([sessionExercise('a1-bench', 'Bench Press', {
    canRestore: true, prescription: [prescription(), prescription(), prescription({ rir: '0' })]
  })]), program());

  it('reaches the workout day and the same block, keeping each day its own sets', () => {
    const before = program();
    const after = applyFinishPlan(before, addedSet().edits, 'block', []);

    expect(find(after, 'a1-bench').sets).toHaveLength(3);
    expect(find(after, 'a2-bench').sets.map(item => item.rir)).toEqual(['3', '1', '0']);
    expect(find(after, 'b1-bench').sets).toHaveLength(2);
    expect(changedDayIds(before, after)).toEqual(['a1', 'a2']);
  });

  it('reaches every block for the whole program', () => {
    const before = program();
    const after = applyFinishPlan(before, addedSet().edits, 'program', []);

    expect(find(after, 'b1-bench').sets).toHaveLength(3);
    expect(changedDayIds(before, after)).toEqual(['a1', 'a2', 'b1']);
  });

  it('keeps two edits made to one day', () => {
    const summary = finishPlanEdits(session([
      sessionExercise('a1-bench', 'Bench Press', { canRestore: true, note: 'Pause on the chest' }),
      sessionExercise('a1-row', 'Row', { canRestore: true, prescription: [prescription()] })
    ]), program());

    const after = applyFinishPlan(program(), summary.edits, 'block', []);

    expect(find(after, 'a1-bench').notes).toBe('Pause on the chest');
    expect(find(after, 'a2-bench').notes).toBe('Pause on the chest');
    expect(find(after, 'a1-row').sets).toHaveLength(1);
  });
});

describe('toDraftSet', () => {
  it('keeps the resistance mode a saved day would otherwise lose', () => {
    expect(toDraftSet(prescription({ resistanceMode: 'bodyweight' })).resistanceMode).toBe('bodyweight');
  });
});
