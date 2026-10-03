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
  ({ exerciseId: 'bench', sets, prescription, trackingMode: undefined });

describe('previous set summaries', () => {
  it('shows the reps and reserve of the matching set from the latest session', () => {
    const history = [session('new', [logged({ reps: 9, rpe: 8, rir: '2' }), logged({ reps: 8, rpe: 7, rir: '3' })]), session('old', [logged({ reps: 5 })])];
    expect(previousSetSummaries(history, current([logged({ done: false }), logged({ done: false })]), true)).toEqual(['9 · 2 RIR', '8 · 3 RIR']);
  });

  it('lines warm-ups up with warm-ups and leaves their reserve out', () => {
    const history = [session('new', [logged({ warmup: true, reps: 5, rpe: 5, rir: '5+' }), logged({ reps: 4, rpe: 8, rir: '2' })])];
    const sets = [logged({ warmup: true, done: false }), logged({ done: false })];
    expect(previousSetSummaries(history, current(sets), true)).toEqual(['5', '4 · 2 RIR']);
  });

  it('leaves a row empty when last time had no such set, or when nothing was recorded', () => {
    const history = [session('new', [logged({ reps: 6, rpe: 8, rir: '2' })])];
    const sets = [logged({ done: false }), logged({ done: false })];
    expect(previousSetSummaries(history, current(sets), true)).toEqual(['6 · 2 RIR', null]);
    expect(previousSetSummaries([], current(sets), true)).toEqual([null, null]);
    expect(previousSetSummaries([session('new', [logged({ reps: null })])], current([logged({ done: false })]), true)).toEqual([null]);
  });

  it('ignores sessions of other exercises, unfinished sets, and the reserve when it is not tracked', () => {
    const history = [session('other', [logged({ reps: 12 })], 'row'), session('new', [logged({ done: false, reps: 3 }), logged({ reps: 7, rpe: 8, rir: '2' })])];
    expect(previousSetSummaries(history, current([logged({ done: false })]), false)).toEqual(['7']);
  });

  it('reads a hold as its time', () => {
    const history = [session('new', [logged({ reps: null, durationSeconds: 45 })])];
    expect(previousSetSummaries(history, { ...current([logged({ done: false })]), trackingMode: 'duration' }, true)).toEqual(['0:45']);
  });
});
