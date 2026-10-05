import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import type { WorkoutRecoveryRecord } from './workoutRecovery';

// The device copy as a plain map: what a crash leaves behind is exactly what was last written.
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

const { adoptServerSession, enqueueFinish, enqueueTiming, enqueueSetEdits, getRecovery, saveStopwatches, startRecovery } = await import('./workoutRecovery');

const session = (patch: Partial<Session> = {}): Session => ({
  id: 'workout-1', templateId: 'day-1', programId: null, name: 'Push', note: '', active: true,
  startedAt: '2026-10-04T08:00:00.000Z', finishedAt: null, pausedAt: null, pausedSeconds: 0, revision: 2,
  exercises: [{
    id: 'bench', exerciseId: 'bench-id', name: 'Bench Press', position: 0, note: '', prescription: [], sequenceGroup: '',
    substitutions: [], progression: null,
    sets: [{ id: 'set-1', position: 0, weightKg: 60, reps: 8, rpe: null, done: false, warmup: false }]
  }],
  volumeKg: null, completedSets: 0, warmupSets: 0, ...patch
});

const swapped = () => session({
  revision: 3,
  exercises: [{ ...session().exercises[0], exerciseId: 'db-press-id', name: 'Dumbbell Press', isReplacement: true }]
});

beforeEach(async () => {
  stored.clear();
  await startRecovery({
    accountId: 'account', displayName: 'Lifter', sessionId: 'workout-1', draft: session(), serverSession: session(),
    preferences: { unit: 'kg', theme: 'dark', restAlerts: false }, activeIndex: 0
  });
});

describe('device recovery after a direct server change', () => {
  it('writes paused timers atomically with pause and shifts their start only once on resume', async () => {
    const start = Date.parse('2026-10-04T08:00:00.000Z');
    await saveStopwatches('account', 'workout-1', { 'set-1': { startedAtMs: start, baseSeconds: 0, targetSeconds: 30 } });
    await enqueueTiming('account', 'pause', new Date(start + 10_000).toISOString(), session({ pausedAt: new Date(start + 10_000).toISOString() }));
    expect((await getRecovery('account'))?.stopwatches?.['set-1'].pausedAtMs).toBe(start + 10_000);
    await enqueueTiming('account', 'resume', new Date(start + 100_000).toISOString(), session());
    const resumed = (await getRecovery('account'))?.stopwatches?.['set-1'];
    expect(resumed?.startedAtMs).toBe(start + 90_000);
    expect(resumed?.pausedAtMs).toBeUndefined();
    await enqueueFinish('account', new Date(start + 110_000).toISOString(), false, session());
    expect((await getRecovery('account'))?.stopwatches).toEqual({});
  });
  it('keeps a swap or restore the server confirmed, so a crash reopens it', async () => {
    await adoptServerSession('account', swapped());

    const reopened = await getRecovery('account');
    expect(reopened?.draft.exercises[0].name).toBe('Dumbbell Press');
    expect(reopened?.serverSession.revision).toBe(3);
  });

  it('leaves local edits still waiting to be sent in place', async () => {
    const logged = session({ exercises: [{ ...session().exercises[0], sets: [{ ...session().exercises[0].sets[0], done: true }] }] });
    await enqueueSetEdits('account', logged, { activeIndex: 0 });

    await adoptServerSession('account', swapped());

    const reopened = await getRecovery('account');
    expect(reopened?.draft.exercises[0].sets[0].done).toBe(true);
    expect(reopened?.serverSession.revision).toBe(3);
  });

  it('ignores a session that is not the one on this device', async () => {
    await expect(adoptServerSession('account', session({ id: 'other' }))).resolves.toBeNull();
  });
});

describe('timed sets in device recovery', () => {
  it('keeps only running stopwatches that belong to this workout', async () => {
    await saveStopwatches('account', 'workout-1', {
      'set-1': { startedAtMs: 1, baseSeconds: 0, targetSeconds: 30 },
      'set-from-elsewhere': { startedAtMs: 1, baseSeconds: 0, targetSeconds: null }
    });

    expect((await getRecovery('account'))?.stopwatches).toEqual({ 'set-1': { startedAtMs: 1, baseSeconds: 0, targetSeconds: 30 } });
  });

  it('survives the next set edit', async () => {
    await saveStopwatches('account', 'workout-1', { 'set-1': { startedAtMs: 1, baseSeconds: 0, targetSeconds: null } });
    await enqueueSetEdits('account', session(), { activeIndex: 0 });

    expect((await getRecovery('account'))?.stopwatches).toEqual({ 'set-1': { startedAtMs: 1, baseSeconds: 0, targetSeconds: null } });
  });
});
