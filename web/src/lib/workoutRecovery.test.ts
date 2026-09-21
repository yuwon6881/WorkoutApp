import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import type { RecoveryLockManager, WorkoutOperation } from './workoutRecovery';
import {
  createRecoveryMutationSerializer, hasPendingTimingOperations, hasUnresolvedRecovery,
  reconcileSetPatchOperation, sameWorkoutEdits
} from './workoutRecovery';
import { startRestAfterSetIsDurable, workoutServerBaseline } from './workoutRecoveryActions';

const session: Session = {
  id: 'workout-1', templateId: null, programId: null, name: 'Workout', note: '', active: true,
  startedAt: '2026-09-21T08:00:00.000Z', finishedAt: null, pausedAt: null, pausedSeconds: 0, revision: 4,
  exercises: [], volumeKg: null, completedSets: 0, warmupSets: 0
};

describe('workout recovery comparison', () => {
  it('treats a revision bump alone as the same user edits', () => {
    expect(sameWorkoutEdits(session, { ...session, revision: 8 })).toBe(true);
  });

  it('detects remote pause, accumulated pause, and finish changes', () => {
    expect(sameWorkoutEdits(session, { ...session, pausedAt: '2026-09-21T08:10:00.000Z' })).toBe(false);
    expect(sameWorkoutEdits(session, { ...session, pausedSeconds: 120 })).toBe(false);
    expect(sameWorkoutEdits(session, { ...session, active: false, finishedAt: '2026-09-21T08:20:00.000Z' })).toBe(false);
  });

  it('treats pending operations and local timing as unresolved recovery', () => {
    const record = {
      schemaVersion: 1 as const, accountId: 'account-1', displayName: 'User', sessionId: session.id,
      draft: { ...session, pausedAt: '2026-09-21T08:10:00.000Z' }, serverSession: session,
      preferences: { unit: 'kg' as const, theme: 'dark' as const, restAlerts: false },
      activeIndex: 0, viewMode: 'focus' as const, conflict: false,
      operations: [{ id: 'pause-1', type: 'pause' as const, occurredAt: '2026-09-21T08:10:00.000Z', revision: null, createdAt: '2026-09-21T08:10:00.000Z' }],
      updatedAt: '2026-09-21T08:10:00.000Z'
    };
    expect(hasUnresolvedRecovery(record)).toBe(true);
    expect(hasPendingTimingOperations(record)).toBe(true);
  });

  it('rebases the next drain session and revision from the reconciled server copy', () => {
    const localBaseline = { ...session, revision: 4 };
    const reconciledServerSession = { ...session, revision: 12, note: 'remote update' };
    const baseline = workoutServerBaseline(reconciledServerSession);
    expect(baseline).toEqual({ session: reconciledServerSession, revision: 12 });
    expect(baseline.session).not.toBe(localBaseline);
  });

  it('starts rest only after the set edit is durably acknowledged', async () => {
    let acknowledge!: (saved: boolean) => void;
    const persist = () => new Promise<boolean>(resolve => { acknowledge = resolve; });
    const started: string[] = [];
    const pending = startRestAfterSetIsDurable(persist, () => started.push('rest'));

    expect(started).toEqual([]);
    acknowledge(true);
    await expect(pending).resolves.toBe(true);
    expect(started).toEqual(['rest']);
  });

  it('does not start rest when the set edit was not durably saved', async () => {
    const start = vi.fn();
    await expect(startRestAfterSetIsDurable(async () => false, start)).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('set patch coalescing', () => {
  const baseline = { weightKg: 5, reps: 8, rpe: null, done: false, warmup: false, resistanceMode: 'external' as const };
  const changed = { ...baseline, weightKg: 6 };

  it('removes an unsent edit when a set is reverted to the server baseline', () => {
    const operations: WorkoutOperation[] = [{ id: 'unsent', type: 'setPatch', setId: 'set-1', patch: changed, revision: null, createdAt: 'now' }];
    reconcileSetPatchOperation(operations, 'set-1', baseline, baseline, 'later');
    expect(operations).toEqual([]);
  });

  it('keeps a bound uncertain edit exact and queues a compensating revert', () => {
    const operations: WorkoutOperation[] = [{ id: 'sent', type: 'setPatch', setId: 'set-1', patch: changed, revision: 4, createdAt: 'now' }];
    reconcileSetPatchOperation(operations, 'set-1', baseline, baseline, 'later');
    expect(operations).toHaveLength(2);
    expect(operations[0]).toEqual({ id: 'sent', type: 'setPatch', setId: 'set-1', patch: changed, revision: 4, createdAt: 'now' });
    expect(operations[1]).toMatchObject({ type: 'setPatch', setId: 'set-1', patch: baseline, revision: null });
  });

  it('reverts to baseline after replacing a later unsent patch behind an uncertain request', () => {
    const operations: WorkoutOperation[] = [
      { id: 'sent', type: 'setPatch', setId: 'set-1', patch: changed, revision: 4, createdAt: 'now' },
      { id: 'unsent', type: 'setPatch', setId: 'set-1', patch: { ...baseline, weightKg: 7 }, revision: null, createdAt: 'later' }
    ];
    reconcileSetPatchOperation(operations, 'set-1', baseline, baseline, 'reverted');
    expect(operations).toHaveLength(2);
    expect(operations[0].id).toBe('sent');
    expect(operations[1]).toMatchObject({ type: 'setPatch', setId: 'set-1', patch: baseline, revision: null });
  });

  it('coalesces a subsequent unsent edit without changing its identity', () => {
    const operations: WorkoutOperation[] = [{ id: 'unsent', type: 'setPatch', setId: 'set-1', patch: changed, revision: null, createdAt: 'now' }];
    const newer = { ...baseline, weightKg: 7 };
    reconcileSetPatchOperation(operations, 'set-1', newer, baseline, 'later');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ id: 'unsent', patch: newer });
  });
});

describe('cross-tab recovery mutation serialization', () => {
  it('uses the same account lock across independent app instances', async () => {
    const queues = new Map<string, Promise<void>>();
    const names: string[] = [];
    const locks: RecoveryLockManager = {
      request: async <T>(name: string, _options: { mode: 'exclusive' }, action: () => Promise<T>) => {
        names.push(name);
        const previous = queues.get(name) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => { release = resolve; });
        queues.set(name, previous.then(() => current));
        await previous;
        try { return await action(); }
        finally { release(); }
      }
    };
    const tabA = createRecoveryMutationSerializer(locks);
    const tabB = createRecoveryMutationSerializer(locks);
    let value = 0;
    const increment = async () => { const before = value; await new Promise(resolve => setTimeout(resolve, 1)); value = before + 1; };
    await Promise.all([tabA('account-1', increment), tabB('account-1', increment)]);
    expect(value).toBe(2);
    expect(names).toEqual(['workout-recovery-write:account-1', 'workout-recovery-write:account-1']);
  });
});
