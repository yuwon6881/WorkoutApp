import type { Session } from '../types';
import { ApiError, api } from '../lib/api';
import type { SaveQueue } from '../lib/queue';
import { adoptServerSession, type WorkoutRecoveryRecord } from '../lib/workoutRecovery';

/// Swaps and restores go straight to the server: they need its catalog, swap rules and the plan
/// snapshot taken when the workout started. Edits still waiting on this device are sent first, so
/// each request reads the latest revision, and the result becomes the device recovery copy.
export function useWorkoutExerciseList({
  accountId,
  draft,
  online,
  finishIntentAt,
  queue,
  revision,
  serverSession,
  drain,
  setDraft,
  onSaved,
  onRecoveryChange,
  setBusy,
  setError
}: {
  accountId: string;
  draft: Session;
  online: boolean;
  finishIntentAt: string | null;
  queue: SaveQueue;
  revision: { current: number };
  serverSession: { current: Session };
  drain: () => Promise<void>;
  setDraft: (session: Session) => void;
  onSaved: (session: Session) => void;
  onRecoveryChange: (record: WorkoutRecoveryRecord | null) => void;
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
        revision.current = saved.revision; serverSession.current = saved; setDraft(saved); onSaved(saved);
        // Without device recovery (a private window) the server copy is all there is.
        const record = await adoptServerSession(accountId, saved).catch(() => null);
        if (record) onRecoveryChange(record);
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
