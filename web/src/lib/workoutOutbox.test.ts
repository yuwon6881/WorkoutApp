import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';

const mocks = vi.hoisted(() => ({
  api: { patchWorkoutSet: vi.fn() },
  record: null as unknown
}));

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } get conflict() { return this.status === 409; } },
  api: mocks.api
}));

vi.mock('./workoutRecovery', () => ({
  getRecovery: vi.fn(async () => mocks.record),
  sameWorkoutEdits: (left: Session, right: Session) => JSON.stringify(left) === JSON.stringify(right),
  setConflict: vi.fn(),
  clearRecovery: vi.fn(),
  withRecoveryLock: vi.fn(async (_accountId: string, _sessionId: string, action: () => Promise<void>) => action()),
  bindOperation: vi.fn(async (_accountId: string, operationId: string, revision: number) => {
    const record = mocks.record as { operations: Array<{ id: string; revision: number | null }> };
    const operation = record.operations.find(item => item.id === operationId)!;
    operation.revision = revision;
    return record;
  }),
  acknowledgeOperation: vi.fn(async (_accountId: string, operationId: string, saved: Session) => {
    const record = mocks.record as { operations: Array<{ id: string }>; serverSession: Session };
    record.operations = record.operations.filter(item => item.id !== operationId);
    record.serverSession = saved;
    return record;
  })
}));

import { drainWorkoutOutbox } from './workoutOutbox';
import { api } from './api';

const session: Session = {
  id: 'workout-1', templateId: null, programId: null, name: 'Workout', note: '', active: true,
  startedAt: '2026-09-21T08:00:00.000Z', finishedAt: null, pausedAt: null, pausedSeconds: 0, revision: 12,
  exercises: [], volumeKg: null, completedSets: 0, warmupSets: 0
};

describe('durable workout operation replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record = {
      schemaVersion: 1, accountId: 'account-1', displayName: 'User', sessionId: session.id,
      draft: session, serverSession: session, preferences: { unit: 'kg', theme: 'dark', restAlerts: false },
      activeIndex: 0, viewMode: 'focus', conflict: false,
      operations: [{ id: 'mutation-1', type: 'setPatch', setId: 'set-1', patch: { done: true }, revision: null, createdAt: '2026-09-21T08:01:00.000Z' }]
    };
  });

  it('persists one fixed revision and mutation identity across an uncertain set-patch retry', async () => {
    vi.mocked(api.patchWorkoutSet).mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ ...session, revision: 13 });
    const handlers = { onSaved: vi.fn(), onFinished: vi.fn(), onConflict: vi.fn() };

    await expect(drainWorkoutOutbox('account-1', session.id, () => session, handlers)).rejects.toThrow('connection lost');
    expect(api.patchWorkoutSet).toHaveBeenNthCalledWith(1, session.id, 'set-1', { done: true, revision: 12, mutationId: 'mutation-1' });
    expect((mocks.record as { operations: Array<{ revision: number | null }> }).operations[0].revision).toBe(12);

    await drainWorkoutOutbox('account-1', session.id, () => session, handlers);
    expect(api.patchWorkoutSet).toHaveBeenNthCalledWith(2, session.id, 'set-1', { done: true, revision: 12, mutationId: 'mutation-1' });
    expect((mocks.record as { operations: unknown[] }).operations).toHaveLength(0);
    expect(handlers.onSaved).toHaveBeenCalledOnce();
  });
});
