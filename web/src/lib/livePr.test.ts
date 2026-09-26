import { describe, expect, it } from 'vitest';
import type { LoggedSet, SessionExercise } from '../types';
import { newBestAfterLogging } from './livePr';

function set(patch: Partial<LoggedSet>): LoggedSet {
  return { id: crypto.randomUUID(), position: 0, weightKg: 60, reps: 5, rpe: 8, done: true, warmup: false, ...patch };
}

function exercise(sets: LoggedSet[], previousBestE1rmKg: number | null): SessionExercise {
  return {
    id: 'e', exerciseId: 'bench', name: 'Bench', position: 0, note: '', prescription: [], sets,
    sequenceGroup: '', substitutions: [], progression: null, previousBestE1rmKg
  };
}

describe('live personal bests', () => {
  it('reports a working set that beats every finished session', () => {
    // 65 x 5 @ 8 -> 65 * (1 + 7/30) = 80.17, above a previous best of 74.
    expect(newBestAfterLogging(exercise([set({ weightKg: 65 })], 74), 0)).toBeCloseTo(80.17, 2);
  });

  it('says nothing without finished history, for warm-ups, or for an equal estimate', () => {
    expect(newBestAfterLogging(exercise([set({ weightKg: 65 })], null), 0)).toBeNull();
    expect(newBestAfterLogging(exercise([set({ weightKg: 65, warmup: true })], 74), 0)).toBeNull();
    expect(newBestAfterLogging(exercise([set({ weightKg: 60 })], 74), 0)).toBeNull();
  });

  it('reports each improvement once, not every set that clears the old bar', () => {
    const sets = [set({ weightKg: 70 }), set({ weightKg: 65 })];
    expect(newBestAfterLogging(exercise(sets, 74), 1)).toBeNull();
    expect(newBestAfterLogging(exercise([set({ weightKg: 65 }), set({ weightKg: 70 })], 74), 1)).not.toBeNull();
  });
});
