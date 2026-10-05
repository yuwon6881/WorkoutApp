import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Session } from '../types';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import { drainWorkoutOutbox } from '../lib/workoutOutbox';
import { withServerFlags } from '../lib/workoutDraft';

type Options = {
  accountId: string; sessionId: string; online: boolean; recoveryConflict: boolean;
  serverSession: MutableRefObject<Session>; revision: MutableRefObject<number>;
  onSaved: (session: Session) => void; onFinish: (session: Session) => void;
  onRecoveryChange: (record: WorkoutRecoveryRecord | null) => void;
  setDraft: Dispatch<SetStateAction<Session>>;
  setFinishIntentAt: (at: string | null) => void;
  setBusy: (busy: boolean) => void; setConfirm: (value: null) => void;
  setError: (message: string) => void; setLocalStatus: (message: string) => void;
  setRecoveryConflict: (conflict: boolean) => void;
};

export function useWorkoutDrain(options: Options) {
  const { accountId, sessionId, online, recoveryConflict, serverSession, revision, onSaved, onFinish,
    onRecoveryChange, setDraft, setFinishIntentAt, setBusy, setConfirm, setError, setLocalStatus, setRecoveryConflict } = options;
  return useCallback(async () => {
    if (!online || recoveryConflict) return;
    await drainWorkoutOutbox(accountId, sessionId, () => serverSession.current, {
      onSaved: (saved, nextRecovery) => {
        serverSession.current = saved;
        revision.current = saved.revision;
        onSaved(saved);
        setDraft(current => withServerFlags(current, saved));
        onRecoveryChange(nextRecovery);
        setLocalStatus(nextRecovery?.operations.length ? 'Saving…' : 'Synced.');
      },
      onFinished: onFinish,
      onFinishReview: (saved, nextRecovery) => {
        serverSession.current = saved;
        revision.current = saved.revision;
        onSaved(saved);
        onRecoveryChange(nextRecovery);
        setFinishIntentAt(null);
        setBusy(false);
        setConfirm(null);
        setError('The program changed before finishing. Review the program changes again, or save just this workout.');
        setLocalStatus('Workout changes are saved. Finish needs review.');
      },
      onConflict: nextRecovery => {
        setRecoveryConflict(true);
        onRecoveryChange(nextRecovery);
        setError('This workout changed on another device. Your local copy is safe; choose which version to keep.');
      }
    });
  }, [accountId, sessionId, online, recoveryConflict, onSaved, onFinish, onRecoveryChange]);
}
