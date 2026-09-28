import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Session } from '../types';
import { clearRecovery, keepLocalWorkout, useServerWorkout, type WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import { workoutServerBaseline } from '../lib/workoutRecoveryActions';
import { restTimer } from '../lib/restTimer';

export function useWorkoutConflictResolution({
  accountId,
  online,
  recovery,
  revision,
  serverSession,
  setDraft,
  setFinishIntentAt,
  setRecoveryConflict,
  setError,
  onRecoveryChange,
  onClose
}: {
  accountId: string;
  online: boolean;
  recovery: WorkoutRecoveryRecord | null;
  revision: MutableRefObject<number>;
  serverSession: MutableRefObject<Session>;
  setDraft: Dispatch<SetStateAction<Session>>;
  setFinishIntentAt: Dispatch<SetStateAction<string | null>>;
  setRecoveryConflict: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  onRecoveryChange: (record: WorkoutRecoveryRecord | null) => void;
  onClose: () => void;
}) {
  return async function resolveConflict(choice: 'server' | 'local') {
    if (!recovery) return;
    try {
      if (choice === 'server') {
        if (!recovery.serverSession.active) {
          await clearRecovery(accountId);
          setFinishIntentAt(null);
          setRecoveryConflict(false);
          onRecoveryChange(null);
          restTimer.skip();
          onClose();
          return;
        }
        const next = await useServerWorkout(accountId, recovery.serverSession);
        setDraft(recovery.serverSession);
        serverSession.current = recovery.serverSession;
        revision.current = recovery.serverSession.revision;
        setFinishIntentAt(null);
        setRecoveryConflict(false);
        onRecoveryChange(next);
        setError('');
      } else {
        if (!online) {
          setError('Reconnect before applying the on-device version.');
          return;
        }
        if (!recovery.serverSession.active) {
          setError('This workout is already finished on the server. Use the server copy to return to training.');
          return;
        }
        const next = await keepLocalWorkout(accountId, recovery.serverSession);
        const baseline = workoutServerBaseline(next.serverSession);
        serverSession.current = baseline.session;
        revision.current = baseline.revision;
        setFinishIntentAt(next.operations.find(operation => operation.type === 'finish')?.finishedAt ?? null);
        setRecoveryConflict(false);
        onRecoveryChange(next);
        setError('');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not resolve this workout conflict.');
    }
  };
}
