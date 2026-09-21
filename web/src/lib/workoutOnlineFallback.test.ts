import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';

const mocks = vi.hoisted(() => ({
  pauseWorkout: vi.fn(), resumeWorkout: vi.fn(), saveWorkout: vi.fn(), finishWorkout: vi.fn()
}));

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } get conflict() { return this.status === 409; } },
  api: mocks
}));

import { applyOnlineTiming, finishOnlineWithoutRecovery } from './workoutOutbox';

const session: Session = {
  id: 'workout-1', templateId: null, programId: null, name: 'Workout', note: 'note', active: true,
  startedAt: '2026-09-21T08:00:00.000Z', finishedAt: null, pausedAt: null, pausedSeconds: 0, revision: 5,
  exercises: [], volumeKg: null, completedSets: 0, warmupSets: 0
};

describe('online workout fallback without device storage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses stable mutation identity for online pause and resume attempts', async () => {
    mocks.pauseWorkout.mockResolvedValueOnce({ ...session, pausedAt: '2026-09-21T08:01:00.000Z', revision: 6 });
    mocks.resumeWorkout.mockResolvedValueOnce({ ...session, pausedSeconds: 60, revision: 7 });
    await applyOnlineTiming(session.id, 'pause', 5, 'pause-id', '2026-09-21T08:01:00.000Z');
    await applyOnlineTiming(session.id, 'resume', 6, 'resume-id', '2026-09-21T08:02:00.000Z');
    expect(mocks.pauseWorkout).toHaveBeenCalledWith(session.id, { revision: 5, mutationId: 'pause-id', occurredAt: '2026-09-21T08:01:00.000Z' });
    expect(mocks.resumeWorkout).toHaveBeenCalledWith(session.id, { revision: 6, mutationId: 'resume-id', occurredAt: '2026-09-21T08:02:00.000Z' });
  });

  it('saves the latest draft before finishing and preserves fixed timestamps and identities', async () => {
    const saved = { ...session, revision: 6 };
    const finished = { ...saved, active: false, finishedAt: '2026-09-21T08:10:00.000Z', revision: 7 };
    mocks.saveWorkout.mockResolvedValueOnce(saved);
    mocks.finishWorkout.mockResolvedValueOnce(finished);
    const result = await finishOnlineWithoutRecovery(session, 5, 'save-id', 'finish-id', finished.finishedAt!, true);
    expect(mocks.saveWorkout).toHaveBeenCalledWith(session.id, expect.objectContaining({ note: 'note', revision: 5, idempotencyId: 'save-id' }));
    expect(mocks.finishWorkout).toHaveBeenCalledWith(session.id, {
      revision: 6, mutationId: 'finish-id', finishedAt: '2026-09-21T08:10:00.000Z', retainExerciseSwaps: true
    });
    expect(result).toEqual(finished);
  });
});
