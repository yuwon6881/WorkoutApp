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
  /// The page can hold an older revision than the server (a watch, another device, or a notification
  /// moved it while the recovery copy was read). Pending edits are already sent, so when the server says
  /// the revision is stale and a re-read shows a newer one, the request is repeated once on that revision.
  /// A conflict at an unchanged revision is a real rule (such as a logged set) and is shown as is.
  async function sendCurrent(request: (revision: number, idempotencyId: string) => Promise<Session>, idempotencyId: string) {
    const sent = revision.current;
    try { return await request(sent, idempotencyId); }
    catch (failure) {
      if (!(failure instanceof ApiError) || !failure.conflict) throw failure;
      const latest = await api.getWorkout(draft.id).catch(() => null);
      if (!latest?.active || latest.revision === sent) throw failure;
      return await request(latest.revision, idempotencyId);
    }
  }

  async function changeExerciseList(
    key: string, request: (revision: number, idempotencyId: string) => Promise<Session>, failureMessage: string
  ) {
    if (!online || finishIntentAt) { setError('Connect before changing the exercise list.'); return; }
    setBusy(true); setError('');
    try {
      queue.push(key, async () => {
        await drain();
        // A retry is the same logical request, so the server can recognise it if the first one landed.
        const idempotencyId = crypto.randomUUID();
        const saved = await sendCurrent(request, idempotencyId);
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
      changeExerciseList(`workout-swap-${sessionExerciseId}`, (current, idempotencyId) => api.substituteSessionExercise(draft.id, {
        sessionExerciseId, replacementExerciseId, replacementName, revision: current, idempotencyId
      }), 'Could not swap this exercise.'),
    restoreExercise: (sessionExerciseId: string) =>
      changeExerciseList(`workout-restore-${sessionExerciseId}`, (current, idempotencyId) => api.restoreSessionExercise(draft.id, {
        sessionExerciseId, revision: current, idempotencyId
      }), 'Could not restore this exercise.'),
    restoreWorkout: () =>
      changeExerciseList('workout-restore', (current, idempotencyId) => api.restoreWorkout(draft.id, {
        revision: current, idempotencyId
      }), 'Could not restore the program defaults.')
  };
}
