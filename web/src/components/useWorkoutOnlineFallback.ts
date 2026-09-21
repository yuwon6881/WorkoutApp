import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Preferences, Session } from '../types';
import { applyOnlineTiming, finishOnlineWithoutRecovery } from '../lib/workoutOutbox';
import { clearRecovery, getRecovery, reconcileDirectTiming, sameWorkoutEdits } from '../lib/workoutRecovery';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import type { SaveQueue } from '../lib/queue';
import { restTimer } from '../lib/restTimer';

type TimingIntent = { sessionId: string; kind: 'pause' | 'resume'; occurredAt: string; mutationId: string };
type FinishIntent = { sessionId: string; draft: Session; revision: number; finishedAt: string; saveMutationId: string; finishMutationId: string; retainExerciseSwaps: boolean };

/// Direct requests are a last resort when IndexedDB is unavailable. Stable identities protect
/// retries in the current page, while the UI must not claim they survive closing the page.
export function useWorkoutOnlineFallback(args: {
  sessionId: string;
  accountId: string;
  online: boolean;
  queue: SaveQueue;
  preferences: Preferences;
  recovery: WorkoutRecoveryRecord | null;
  revision: MutableRefObject<number>;
  serverSession: MutableRefObject<Session>;
  onSaved: (session: Session) => void;
  onRecoveryChange: (record: WorkoutRecoveryRecord | null) => void;
  setDraft: (session: Session) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
  setLocalStatus: (status: string) => void;
}) {
  const timingIntent = useRef<TimingIntent | null>(null);
  const finishIntent = useRef<FinishIntent | null>(null);
  useEffect(() => { timingIntent.current = null; finishIntent.current = null; }, [args.sessionId]);

  const sendTiming = useCallback(async (kind: 'pause' | 'resume', occurredAt: string) => {
    if (!args.online) throw new Error('This browser cannot save the workout locally. Reconnect before changing pause timing.');
    let intent = timingIntent.current;
    if (intent && (intent.sessionId !== args.sessionId || intent.kind !== kind))
      throw new Error('A timing request needs confirmation. Retry it before making another timing change.');
    intent ??= { sessionId: args.sessionId, kind, occurredAt, mutationId: crypto.randomUUID() };
    timingIntent.current = intent;
    args.setBusy(true);
    try {
      const local = args.recovery ?? await getRecovery(args.accountId).catch(() => null);
      if (local?.conflict || local?.operations.length)
        throw new Error('Pending workout changes must sync or be reviewed before pause timing can be sent directly. Your local changes remain saved.');
      await args.queue.whenIdle();
      const saved = await applyOnlineTiming(args.sessionId, kind, args.revision.current, intent.mutationId, intent.occurredAt);
      args.serverSession.current = saved;
      args.revision.current = saved.revision;
      args.setDraft(saved);
      args.onSaved(saved);
      args.onRecoveryChange(await reconcileDirectTiming(args.accountId, saved, args.preferences).catch(() => null));
      if (kind === 'pause') restTimer.pause(); else restTimer.resume();
      timingIntent.current = null;
      args.setLocalStatus('Pause timing saved to the server. Device recovery is unavailable on this browser.');
      args.setError('');
    } finally { args.setBusy(false); }
  }, [args]);

  const finish = useCallback(async (draft: Session, retainExerciseSwaps: boolean) => {
    if (!args.online) throw new Error('This browser cannot save the workout locally. Reconnect before finishing.');
    const local = args.recovery ?? await getRecovery(args.accountId).catch(() => null);
    if (local?.conflict || local?.operations.length)
      throw new Error('Pending workout changes must sync or be reviewed before finishing directly. Your local changes remain saved.');
    let intent = finishIntent.current;
    if (intent && (!sameWorkoutEdits(intent.draft, draft) || intent.retainExerciseSwaps !== retainExerciseSwaps))
      throw new Error('The workout changed after a finish request. Retry the original finish or reload from the server.');
    intent ??= {
      sessionId: args.sessionId, draft, revision: args.revision.current, finishedAt: new Date().toISOString(),
      saveMutationId: crypto.randomUUID(), finishMutationId: crypto.randomUUID(), retainExerciseSwaps
    };
    finishIntent.current = intent;
    args.setLocalStatus('Device recovery is unavailable. Finishing directly with the server…');
    await args.queue.whenIdle();
    const saved = await finishOnlineWithoutRecovery(intent.draft, intent.revision, intent.saveMutationId, intent.finishMutationId, intent.finishedAt, intent.retainExerciseSwaps);
    finishIntent.current = null;
    if (local) {
      await clearRecovery(args.accountId).catch(() => undefined);
      args.onRecoveryChange(null);
    }
    restTimer.skip();
    return saved;
  }, [args]);

  return { sendTiming, finish, hasPendingFinish: () => finishIntent.current !== null };
}
