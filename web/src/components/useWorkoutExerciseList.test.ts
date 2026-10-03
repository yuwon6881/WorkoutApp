import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import { ApiError, api } from '../lib/api';
import { SaveQueue } from '../lib/queue';
import * as recovery from '../lib/workoutRecovery';
import { useWorkoutExerciseList } from './useWorkoutExerciseList';

const draft: Session = {
  id: 'workout-1', templateId: 'template-1', programId: null, name: 'Workout', note: '', active: true,
  startedAt: '2026-10-03T08:00:00.000Z', finishedAt: null, revision: 3, volumeKg: null,
  completedSets: 0, warmupSets: 0, exercises: []
};

function fixture() {
  const revision = { current: draft.revision };
  const serverSession = { current: draft };
  const setBusy = vi.fn();
  const setError = vi.fn();
  const onSaved = vi.fn();
  const onRecoveryChange = vi.fn();
  const drain = vi.fn(async () => { revision.current = 4; });
  const actions = useWorkoutExerciseList({
    accountId: 'account', draft, online: true, finishIntentAt: null, queue: new SaveQueue(), revision, serverSession, drain,
    setDraft: vi.fn(), onSaved, onRecoveryChange, setBusy, setError
  });
  return { ...actions, revision, serverSession, setBusy, setError, onSaved, onRecoveryChange, drain };
}

afterEach(() => vi.restoreAllMocks());

describe('workout exercise-list writes', () => {
  it('keeps restore busy until the server answers and uses the drained revision', async () => {
    vi.spyOn(recovery, 'adoptServerSession').mockResolvedValue(null);
    let release!: (saved: Session) => void;
    const held = new Promise<Session>(resolve => { release = resolve; });
    const request = vi.spyOn(api, 'restoreWorkout').mockReturnValue(held);
    const f = fixture();
    const operation = f.restoreWorkout();
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.calls[0][1].revision).toBe(4);
    expect(f.setBusy).toHaveBeenLastCalledWith(true);
    expect(f.onSaved).not.toHaveBeenCalled();
    const saved = { ...draft, revision: 5 };
    release(saved);
    await operation;
    expect(f.onSaved).toHaveBeenCalledWith(saved);
    expect(f.revision.current).toBe(5);
    expect(f.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('makes the restored workout the device recovery copy and the next sync baseline', async () => {
    const saved = { ...draft, revision: 5 };
    const record = { sessionId: draft.id } as recovery.WorkoutRecoveryRecord;
    const adopt = vi.spyOn(recovery, 'adoptServerSession').mockResolvedValue(record);
    vi.spyOn(api, 'restoreSessionExercise').mockResolvedValue(saved);
    const f = fixture();

    await f.restoreExercise('bench');

    expect(adopt).toHaveBeenCalledWith('account', saved);
    expect(f.onRecoveryChange).toHaveBeenCalledWith(record);
    expect(f.serverSession.current).toBe(saved);
  });

  it('shows a rejected restore instead of reporting completion', async () => {
    vi.spyOn(api, 'restoreWorkout').mockRejectedValue(new ApiError('This changed on another device.', 409));
    const f = fixture();
    await f.restoreWorkout();
    expect(f.setError).toHaveBeenLastCalledWith('This changed on another device.');
    expect(f.onSaved).not.toHaveBeenCalled();
    expect(f.setBusy).toHaveBeenLastCalledWith(false);
  });
});
