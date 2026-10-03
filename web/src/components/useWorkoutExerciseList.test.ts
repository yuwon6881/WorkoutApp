import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import { ApiError, api } from '../lib/api';
import { SaveQueue } from '../lib/queue';
import { useWorkoutExerciseList } from './useWorkoutExerciseList';

const draft: Session = {
  id: 'workout-1', templateId: 'template-1', programId: null, name: 'Workout', note: '', active: true,
  startedAt: '2026-10-03T08:00:00.000Z', finishedAt: null, revision: 3, volumeKg: null,
  completedSets: 0, warmupSets: 0, exercises: []
};

function fixture() {
  const revision = { current: draft.revision };
  const setBusy = vi.fn();
  const setError = vi.fn();
  const onSaved = vi.fn();
  const drain = vi.fn(async () => { revision.current = 4; });
  const actions = useWorkoutExerciseList({
    draft, online: true, finishIntentAt: null, queue: new SaveQueue(), revision, drain,
    setDraft: vi.fn(), onSaved, setBusy, setError
  });
  return { ...actions, revision, setBusy, setError, onSaved, drain };
}

afterEach(() => vi.restoreAllMocks());

describe('workout exercise-list writes', () => {
  it('keeps restore busy until the server answers and uses the drained revision', async () => {
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

  it('shows a rejected restore instead of reporting completion', async () => {
    vi.spyOn(api, 'restoreWorkout').mockRejectedValue(new ApiError('This changed on another device.', 409));
    const f = fixture();
    await f.restoreWorkout();
    expect(f.setError).toHaveBeenLastCalledWith('This changed on another device.');
    expect(f.onSaved).not.toHaveBeenCalled();
    expect(f.setBusy).toHaveBeenLastCalledWith(false);
  });
});
