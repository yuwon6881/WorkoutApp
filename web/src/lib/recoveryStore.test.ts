import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import type { WorkoutRecoveryRecord } from './workoutRecovery';
import { RecoveryStore } from './recoveryStore';

const session: Session = { id: 'session', templateId: null, programId: null, name: 'Workout', note: '', active: true,
  startedAt: '2026-11-09T00:00:00Z', finishedAt: null, revision: 1, exercises: [], volumeKg: null, completedSets: 0, warmupSets: 0 };
const record: WorkoutRecoveryRecord = { schemaVersion: 1, accountId: 'a', displayName: 'A', sessionId: session.id,
  draft: session, serverSession: session, preferences: { unit: 'kg', theme: 'dark', restAlerts: false },
  activeIndex: 0, operations: [{ id: 'edit', type: 'save', revision: null, createdAt: '', draft: session }],
  conflict: false, updatedAt: '' };

describe('logger and shell recovery subscriptions', () => {
  it('keeps every edit available without changing the shell snapshot during an edit burst', () => {
    const store = new RecoveryStore();
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    store.set(record);
    const shell = store.getShellSnapshot();
    const latest = { ...record, draft: { ...session, note: 'latest draft' }, updatedAt: 'later' };
    store.set(latest);
    expect(store.getSnapshot()).toBe(latest);
    expect(store.getShellSnapshot()).toBe(shell);
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe(); store.set(null);
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('publishes conflicts, pending finishes, account changes, rest changes and erasure to the shell', () => {
    const store = new RecoveryStore();
    const finishing: WorkoutRecoveryRecord = { ...record, operations: [{ id: 'finish', type: 'finish', revision: null,
      createdAt: '', finishedAt: '2026-11-09T00:30:00Z', retainExerciseSwaps: false }] };
    for (const next of [record, finishing, { ...record, conflict: true }, { ...record, accountId: 'b' },
      { ...record, rest: { generation: 'rest', status: 'running' as const, deadlineUtc: '2026-11-09T00:02:00Z',
        durationMs: 120000, pausedRemainingMs: null, originDeviceId: null } }, null]) {
      const before = store.getShellSnapshot();
      store.set(next);
      expect(store.getShellSnapshot()).not.toBe(before);
    }
  });
});
