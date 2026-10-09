import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import type { WorkoutRecoveryRecord } from './workoutRecovery';

// The device copy as a plain map: a reopened app reads exactly what was last written.
const stored = new Map<string, WorkoutRecoveryRecord>();
vi.mock('./recoveryStorage', () => ({
  getRecoveryStorage: () => ({
    get: async (accountId: string) => structuredClone(stored.get(accountId) ?? null),
    put: async (record: WorkoutRecoveryRecord) => { stored.set(record.accountId, structuredClone(record)); },
    delete: async (accountId: string) => { stored.delete(accountId); },
    getLastAccountId: async () => null,
    setLastAccountId: async () => undefined,
    claimRestAlert: async () => true
  })
}));

const { enqueueSetEdits, getRecovery, startRecovery } = await import('./workoutRecovery');
const { reconcileReopenedWorkout } = await import('./launchRecovery');

const account = { id: 'account', displayName: 'Lifter' };
const preferences = { unit: 'kg' as const, theme: 'dark' as const, restAlerts: false };

const session = (revision: number, done: [boolean, boolean]): Session => ({
  id: 'workout-1', templateId: 'day-1', programId: null, name: 'Push', note: '', active: true,
  startedAt: '2026-10-04T08:00:00.000Z', finishedAt: null, pausedAt: null, pausedSeconds: 0, revision,
  exercises: [{
    id: 'bench', exerciseId: 'bench-id', name: 'Bench Press', position: 0, note: '', prescription: [], sequenceGroup: '',
    substitutions: [], progression: null,
    sets: [
      { id: 'set-1', position: 0, weightKg: 60, reps: 8, rpe: null, done: done[0], warmup: false },
      { id: 'set-2', position: 1, weightKg: 60, reps: 8, rpe: null, done: done[1], warmup: false }
    ]
  }],
  volumeKg: null, completedSets: 0, warmupSets: 0
});

const doneSets = (record: WorkoutRecoveryRecord | null) => record?.draft.exercises[0].sets.map(set => set.done);

async function reopen(server: Session) {
  const local = (await getRecovery(account.id))!;
  return reconcileReopenedWorkout(local, server, account, preferences);
}

beforeEach(async () => {
  stored.clear();
  await startRecovery({
    accountId: account.id, displayName: account.displayName, sessionId: 'workout-1',
    draft: session(2, [false, false]), serverSession: session(2, [false, false]), preferences, activeIndex: 0
  });
});

describe('reopening the workout this device holds', () => {
  // A set logged on the watch or another device while this one was closed once came back
  // unlogged here: the newer server copy was recorded but the old draft was kept.
  it('shows sets another device logged while this one had nothing waiting to send', async () => {
    const reopened = await reopen(session(3, [true, false]));

    expect(doneSets(reopened)).toEqual([true, false]);
    expect(reopened.conflict).toBe(false);
    expect(doneSets(await getRecovery(account.id))).toEqual([true, false]);
  });

  it('repairs a device copy an earlier reopen left behind the server', async () => {
    const stale = (await getRecovery(account.id))!;
    stored.set(account.id, { ...stale, serverSession: session(3, [true, false]) });

    const reopened = await reopen(session(3, [true, false]));

    expect(doneSets(reopened)).toEqual([true, false]);
    expect(reopened.conflict).toBe(false);
  });

  it('keeps an edit still waiting to be sent when the server has not moved', async () => {
    await enqueueSetEdits(account.id, session(2, [false, true]), { activeIndex: 0 });

    const reopened = await reopen(session(2, [false, false]));

    expect(doneSets(reopened)).toEqual([false, true]);
    expect(reopened.conflict).toBe(false);
    expect(reopened.operations.length).toBeGreaterThan(0);
  });

  it('asks for a review when both this device and the server changed the workout', async () => {
    await enqueueSetEdits(account.id, session(2, [false, true]), { activeIndex: 0 });

    const reopened = await reopen(session(3, [true, false]));

    expect(doneSets(reopened)).toEqual([false, true]);
    expect(reopened.conflict).toBe(true);
  });
});
