import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import { clearStopwatches, pauseStopwatches, restoreStopwatches, runningStopwatches, startStopwatch } from './setStopwatch';
import { acknowledgeFinishedSetTimers, withFinishedSetTimers } from './finishedSetTimers';

const session = (): Session => ({
  id: 'session', templateId: null, programId: null, name: 'Workout', note: '', active: true,
  startedAt: new Date().toISOString(), finishedAt: null, revision: 1, volumeKg: null, completedSets: 0, warmupSets: 0,
  exercises: [{ id: 'exercise', exerciseId: null, name: 'Plank', position: 0, note: '', prescription: [],
    sequenceGroup: '', substitutions: [], progression: null,
    sets: [{ id: 'hold', position: 0, weightKg: null, reps: null, durationSeconds: null, rpe: null, done: false, warmup: false }] }]
});
afterEach(() => { clearStopwatches(); vi.useRealTimers(); });

describe('finished timed-set drafts', () => {
  it('captures off-screen and recovered countdowns without logging a set or losing the timer before persistence', () => {
    const now = Date.now();
    restoreStopwatches({ hold: { startedAtMs: now - 60_000, baseSeconds: 0, targetSeconds: 30 } }, now);
    const snapshot = runningStopwatches();
    const original = session();
    const next = withFinishedSetTimers(original, snapshot);
    expect(next.exercises[0].sets[0]).toMatchObject({ durationSeconds: 30, done: false });
    expect(original.exercises[0].sets[0].durationSeconds).toBeNull();
    expect(runningStopwatches().hold.finishedSeconds).toBe(30);
    acknowledgeFinishedSetTimers(next, snapshot);
    expect(runningStopwatches()).toEqual({});
    expect(withFinishedSetTimers(next)).toBe(next);
  });

  it('ignores paused, still running and foreign timers', () => {
    startStopwatch('hold', 0, 30);
    pauseStopwatches();
    restoreStopwatches({ foreign: { startedAtMs: 0, baseSeconds: 0, targetSeconds: 30 } });
    const draft = session();
    expect(withFinishedSetTimers(draft)).toBe(draft);
    acknowledgeFinishedSetTimers(draft, runningStopwatches());
    expect(runningStopwatches()).toHaveProperty('foreign');
    expect(runningStopwatches()).toHaveProperty('hold');
  });

  it('does not consume a restarted timer or overwrite a manual edit after a snapshot', () => {
    restoreStopwatches({ hold: { startedAtMs: 0, baseSeconds: 0, targetSeconds: 30 } });
    const snapshot = runningStopwatches();
    const next = withFinishedSetTimers(session(), snapshot);
    startStopwatch('hold', 0, 60);
    acknowledgeFinishedSetTimers(next, snapshot);
    expect(runningStopwatches().hold.targetSeconds).toBe(60);
    next.exercises[0].sets[0].durationSeconds = 15;
    expect(withFinishedSetTimers(next)).toBe(next);
  });
});
