import { useMemo } from 'react';
import type { Session } from '../types';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';

// A request may finish after account switching. Its server result remains valid for its owner,
// but must not replace the new account's workout or recovery screen.
export function useAccountWorkoutCallbacks(accountId: string, isCurrent: ((id: string) => boolean) | undefined, callbacks: {
  onSaved: (session: Session) => void;
  onFinish: (session: Session) => void;
  onDiscard: () => void;
  onRecoveryChange: (record: WorkoutRecoveryRecord | null) => void;
}) {
  const { onSaved, onFinish, onDiscard, onRecoveryChange } = callbacks;
  return useMemo(() => ({
    onSaved: (session: Session) => { if (isCurrent?.(accountId) !== false) onSaved(session); },
    onFinish: (session: Session) => { if (isCurrent?.(accountId) !== false) onFinish(session); },
    onDiscard: () => { if (isCurrent?.(accountId) !== false) onDiscard(); },
    onRecoveryChange: (record: WorkoutRecoveryRecord | null) => { if (isCurrent?.(accountId) !== false) onRecoveryChange(record); }
  }), [accountId, isCurrent, onSaved, onFinish, onDiscard, onRecoveryChange]);
}
