import { describe, expect, it } from 'vitest';
import type { LoggedSet, RecentExerciseSession, SetPrescription } from '../types';
import { previousSetSummaries } from './previousSets';

const logged = (overrides: Partial<LoggedSet>): LoggedSet => ({
  id: crypto.randomUUID(), done: true, warmup: false, reps: 8, weightKg: 60, rpe: null, rir: null,
  ...overrides
} as LoggedSet);

const plan = (warmup = false): SetPrescription => ({ warmup } as SetPrescription);

const session = (id: string, sets: LoggedSet[], exerciseId = 'bench'): RecentExerciseSession => ({
  id, name: 'Push', startedAt: '2026-01-01T10:00:00Z', finishedAt: '2026-01-01T11:00:00Z',
  exercises: [{ id: `${id}-e`, exerciseId, sets }]
});

const current = (sets: LoggedSet[], prescription = sets.map(set => plan(set.warmup))) =>
  ({ exerciseId: 'bench', name: 'Bench press', sets, prescription, trackingMode: undefined });

describe('previous set summaries', () => {
  it('shows the weight, reps and reserve of the matching set from the latest session', () => {
    const history = [session('new', [logged({ reps: 9, rpe: 8, rir: '2' }), logged({ reps: 8, rpe: 7, rir: '3' })]), session('old', [logged({ reps: 5 })])];
    expect(previousSetSummaries(history, current([logged({ done: false }), logged({ done: false })]), true, 'kg')).toEqual(['60 kg × 9 · 2 RIR', '60 kg × 8 · 3 RIR']);
  });

  it('lines warm-ups up with warm-ups and leaves their reserve out', () => {
    const history = [session('new', [logged({ warmup: true, reps: 5, rpe: 5, rir: '5+' }), logged({ reps: 4, rpe: 8, rir: '2' })])];
    const sets = [logged({ warmup: true, done: false }), logged({ done: false })];
    expect(previousSetSummaries(history, current(sets), true, 'kg')).toEqual(['60 kg × 5', '60 kg × 4 · 2 RIR']);
  });

  it('leaves a row empty when last time had no such set, or when nothing was recorded', () => {
    const history = [session('new', [logged({ reps: 6, rpe: 8, rir: '2' })])];
    const sets = [logged({ done: false }), logged({ done: false })];
    expect(previousSetSummaries(history, current(sets), true, 'kg')).toEqual(['60 kg × 6 · 2 RIR', null]);
    expect(previousSetSummaries([], current(sets), true, 'kg')).toEqual([null, null]);
    expect(previousSetSummaries([session('new', [logged({ reps: null })])], current([logged({ done: false })]), true, 'kg')).toEqual([null]);
  });

  it('ignores sessions of other exercises, unfinished sets, and the reserve when it is not tracked', () => {
    const history = [session('other', [logged({ reps: 12 })], 'row'), session('new', [logged({ done: false, reps: 3 }), logged({ reps: 7, rpe: 8, rir: '2' })])];
    expect(previousSetSummaries(history, current([logged({ done: false })]), false, 'kg')).toEqual(['60 kg × 7']);
  });

  it('compares a technique set with the same technique and straight sets with straight sets', () => {
    const history: RecentExerciseSession[] = [{
      ...session('new', [logged({ position: 0, reps: 10 }), logged({ position: 1, reps: 15 }), logged({ position: 2, reps: 9 })]),
      exercises: [{ id: 'new-e', exerciseId: 'bench', techniques: [null, 'myoreps', null],
        sets: [logged({ position: 0, reps: 10 }), logged({ position: 1, reps: 15 }), logged({ position: 2, reps: 9 })] }]
    }];
    const sets = [logged({ done: false }), logged({ done: false }), logged({ done: false })];
    const prescription = [plan(), { ...plan(), notes: 'Myo-reps' } as SetPrescription, plan()];
    expect(previousSetSummaries(history, current(sets, prescription), false, 'kg')).toEqual(['60 kg × 10', '60 kg × 15', '60 kg × 9']);
    // Turning the last set into myo-reps leaves it without a counterpart from last time.
    const changed = [plan(), plan(), { ...plan(), notes: 'Myo-reps' } as SetPrescription];
    expect(previousSetSummaries(history, current(sets, changed), false, 'kg')).toEqual(['60 kg × 10', '60 kg × 9', '60 kg × 15']);
  });

  it('treats history from a server without techniques as straight sets', () => {
    const history = [session('new', [logged({ position: 0, reps: 10 })])];
    const myo = [{ ...plan(), notes: 'Myo-reps' } as SetPrescription];
    expect(previousSetSummaries(history, current([logged({ done: false })], myo), false, 'kg')).toEqual([null]);
  });

  it('reads a loaded hold as its weight and time', () => {
    const history = [session('new', [logged({ reps: null, durationSeconds: 45 })])];
    expect(previousSetSummaries(history, { ...current([logged({ done: false })]), trackingMode: 'duration' }, true, 'kg')).toEqual(['60 kg · 0:45']);
  });

  it('marks added load, assistance, bodyweight and per-side weights the way the set row enters them', () => {
    const history = (exerciseId: string) => [session('new', [logged({ reps: 8, weightKg: 10, rir: '2' })], exerciseId)];
    const shaped = (name: string, extra: object = {}) =>
      ({ ...current([logged({ done: false })]), name, ...extra });
    expect(previousSetSummaries(history('bench'), shaped('Weighted Pull-Up', { loadModel: 'full_bodyweight' }), true, 'kg')).toEqual(['+10 kg × 8 · 2 RIR']);
    expect(previousSetSummaries(history('bench'), shaped('Assisted Pull-Up', { loadModel: 'full_bodyweight' }), true, 'kg')).toEqual(['10 kg assist × 8 · 2 RIR']);
    expect(previousSetSummaries(history('bench'), shaped('Pull-Up', { loadModel: 'full_bodyweight' }), true, 'kg')).toEqual(['BW × 8 · 2 RIR']);
    expect(previousSetSummaries(history('bench'), shaped('Hammer Curl', { weightBasis: 'per_side' }), false, 'kg')).toEqual(['10 kg/side × 8']);
    expect(previousSetSummaries([session('new', [logged({ reps: 8, weightKg: null })])], current([logged({ done: false })]), false, 'kg')).toEqual(['8']);
  });
});
