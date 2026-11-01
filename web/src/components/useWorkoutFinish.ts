import type { Session } from '../types';
import { ApiError } from '../lib/api';
import { withFinishedSetTimers } from '../lib/finishedSetTimers';
import { haptic } from '../lib/platform';
import type { SaveQueue } from '../lib/queue';
import { restTimer } from '../lib/restTimer';
import { clearStopwatches } from '../lib/setStopwatch';
import { finishBlocker } from '../lib/training';
import { validateSessionDraft } from '../lib/validation';
import { enqueueFinish, enqueueSave, type WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import type { FinishPlanUpdate } from './useFinishPlanUpdate';
import type { useWorkoutOnlineFallback } from './useWorkoutOnlineFallback';

type WorkoutConfirm = 'finish' | 'discard' | 'restore' | null;

/// Finishing a workout: the finish is recorded on the device first (with any program update it
/// carries) and then synced, or sent straight to the server when the browser keeps no recovery
/// copy. The finish is felt the moment it is committed, a refusal the moment it is refused.
export function useWorkoutFinish({
  accountId,
  draft,
  activeIndex,
  online,
  queue,
  recovery,
  recoveryConflict,
  planUpdate,
  onlineFallback,
  drain,
  onFinish,
  onRecoveryChange,
  setBusy,
  setConfirm,
  setError,
  setFinishIntentAt,
  setLocalStatus
}: {
  accountId: string;
  draft: Session;
  activeIndex: number;
  online: boolean;
  queue: SaveQueue;
  recovery: WorkoutRecoveryRecord | null;
  recoveryConflict: boolean;
  planUpdate: FinishPlanUpdate;
  onlineFallback: ReturnType<typeof useWorkoutOnlineFallback>;
  drain: () => Promise<void>;
  onFinish: (session: Session) => void;
  onRecoveryChange: (record: WorkoutRecoveryRecord | null) => void;
  setBusy: (busy: boolean) => void;
  setConfirm: (confirm: WorkoutConfirm) => void;
  setError: (message: string) => void;
  setFinishIntentAt: (finishedAt: string) => void;
  setLocalStatus: (status: string) => void;
}) {
  function refuse(message: string) {
    haptic('warning');
    setError(message);
  }

  function requestFinish() {
    const blocker = finishBlocker(draft);
    if (blocker) { refuse(blocker); return; }
    setConfirm('finish');
  }

  async function finish() {
    let finishingDraft = withFinishedSetTimers(draft);
    const validationError = validateSessionDraft(finishingDraft);
    if (validationError) { refuse(validationError); return; }
    const blocker = finishBlocker(finishingDraft);
    if (blocker) { refuse(blocker); return; }
    if (recoveryConflict) { refuse('Resolve the workout version conflict before finishing.'); return; }
    setBusy(true);
    try {
      if (online) {
        try { await queue.whenIdle(); }
        catch (failure) {
          if (!(failure instanceof ApiError && failure.offline)) throw failure;
        }
      }
      // The program update travels with the finish operation and commits atomically.
      if (!(await planUpdate.apply())) { setBusy(false); return; }
      finishingDraft = withFinishedSetTimers(finishingDraft);
      const finishedAt = new Date().toISOString();
      if (!recovery) {
        if (!online) throw new Error('This browser cannot save the workout locally. Reconnect before finishing.');
        setLocalStatus('Device recovery is unavailable. Finishing directly with the server…');
        const saved = await onlineFallback.finish(finishingDraft, false, planUpdate.input);
        haptic('success');
        onFinish(saved);
        return;
      }
      await enqueueSave(accountId, finishingDraft, { activeIndex });
      const withFinish = await enqueueFinish(accountId, finishedAt, false, finishingDraft, planUpdate.input);
      clearStopwatches();
      onRecoveryChange(withFinish);
      setFinishIntentAt(finishedAt);
      haptic('success');
      setLocalStatus(`Finished on this device at ${new Date(finishedAt).toLocaleTimeString()}. Waiting to sync.`);
      restTimer.skip();
      if (online) {
        queue.push('workout', drain);
        await queue.whenIdle();
      } else {
        setBusy(false);
        setConfirm(null);
      }
    } catch (failure) {
      refuse(failure instanceof Error ? failure.message : 'Could not save this workout.');
      setBusy(false);
      setConfirm(null);
    }
  }

  return { finish, requestFinish };
}
