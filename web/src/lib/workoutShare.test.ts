import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { loggedWorkingShare } from './workoutShare';

function sessionWithSets(sets: Array<{ warmup: boolean; done: boolean }>): Session {
  return {
    id: 'sess-1',
    name: 'Push Day',
    active: true,
    startedAt: '2026-11-24T10:00:00Z',
    exercises: [
      {
        id: 'se-1',
        exerciseId: 'ex-1',
        name: 'Bench Press',
        position: 0,
        note: '',
        prescription: [],
        sequenceGroup: '',
        substitutions: [],
        progression: null,
        sets: sets.map((s, idx) => ({
          id: `set-${idx}`,
          setNumber: idx + 1,
          warmup: s.warmup,
          done: s.done,
          weightKg: 60,
          reps: 8,
        })),
      },
    ],
  } as unknown as Session;
}

describe('loggedWorkingShare', () => {
  it('returns 0 when no working sets exist, even if warmup sets are logged', () => {
    expect(loggedWorkingShare(sessionWithSets([]))).toBe(0);
    expect(loggedWorkingShare(sessionWithSets([{ warmup: true, done: true }]))).toBe(0);
  });

  it('ignores warmup sets when computing the completed share of working sets', () => {
    const session = sessionWithSets([
      { warmup: true, done: true },
      { warmup: true, done: false },
      { warmup: false, done: true },
      { warmup: false, done: false },
    ]);
    expect(loggedWorkingShare(session)).toBe(0.5);
  });

  it('returns 1 once every working set is done', () => {
    const session = sessionWithSets([
      { warmup: true, done: false },
      { warmup: false, done: true },
      { warmup: false, done: true },
    ]);
    expect(loggedWorkingShare(session)).toBe(1);
  });
});
