import type { Session } from '../types';
import { ApiError, api } from '../lib/api';
import type { SaveQueue } from '../lib/queue';

/// Swaps and restores go straight to the server: they need its catalog, swap rules and the plan
/// snapshot taken when the workout started. Edits still waiting on this device are sent first, so
/// each request reads the latest revision.
export function useWorkoutExerciseList({
  draft,
  online,
  finishIntentAt,
  queue,
  revision,
  drain,
  setDraft,
  onSaved,
  setBusy,
  setError
}: {
  draft: Session;
  online: boolean;
  finishIntentAt: string | null;
  queue: SaveQueue;
  revision: { current: number };
  drain: () => Promise<void>;
  setDraft: (session: Session) => void;
  onSaved: (session: Session) => void;
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
}) {
  async function changeExerciseList(key: string, request: (revision: number) => Promise<Session>, failureMessage: string) {
    if (!online || finishIntentAt || draft.pausedAt) { setError('Connect and resume the workout before changing its exercise list.'); return; }
    setBusy(true); setError('');
    try {
      queue.push(key, async () => {
        await drain();
        const saved = await request(revision.current);
        revision.current = saved.revision; setDraft(saved); onSaved(saved);
      });
      await queue.whenIdle();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : failureMessage);
    } finally { setBusy(false); }
  }

  return {
    swapExercise: (sessionExerciseId: string, replacementExerciseId: string | null, replacementName: string) =>
      changeExerciseList(`workout-swap-${sessionExerciseId}`, current => api.substituteSessionExercise(draft.id, {
        sessionExerciseId, replacementExerciseId, replacementName, revision: current, idempotencyId: crypto.randomUUID()
      }), 'Could not swap this exercise.'),
    restoreExercise: (sessionExerciseId: string) =>
      changeExerciseList(`workout-restore-${sessionExerciseId}`, current => api.restoreSessionExercise(draft.id, {
        sessionExerciseId, revision: current, idempotencyId: crypto.randomUUID()
      }), 'Could not restore this exercise.'),
    restoreWorkout: () =>
      changeExerciseList('workout-restore', current => api.restoreWorkout(draft.id, {
        revision: current, idempotencyId: crypto.randomUUID()
      }), 'Could not restore the program defaults.')
  };
}
