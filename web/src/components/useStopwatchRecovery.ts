import { useEffect } from 'react';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import { saveStopwatches } from '../lib/workoutRecovery';
import { clearStopwatches, discardStopwatch, pauseStopwatches, resumeStopwatches, restoreStopwatches, runningStopwatches, subscribeStopwatches } from '../lib/setStopwatch';
import type { Session } from '../types';

/// Timed sets count in memory so a hold keeps going across exercise pages. This keeps a copy with
/// the workout's device recovery as each one starts or stops, and picks the copy back up when the
/// workout reopens after the app was closed or crashed, so the hold resumes from its real start.
export function useStopwatchRecovery(accountId: string, sessionId: string, recovery: WorkoutRecoveryRecord | null,
  draft: Session, onPersistenceFailure: (message: string) => void) {
  const saved = recovery?.sessionId === sessionId ? recovery.stopwatches : undefined;
  const storageReady = recovery?.sessionId === sessionId;
  const pendingSets = draft.exercises.flatMap(e => e.sets.filter(s => !s.done).map(s => s.id)).join(',');

  useEffect(() => {
    const allowed = new Set(draft.exercises.flatMap(e => e.sets.map(s => s.id)));
    for (const id of Object.keys(runningStopwatches())) if (!allowed.has(id)) discardStopwatch(id);
    if (saved) restoreStopwatches(Object.fromEntries(Object.entries(saved).filter(([id]) => allowed.has(id))));
    // Only the copy found when the workout opens: later copies are this screen's own saves.
  }, [accountId, sessionId]);

  useEffect(() => {
    if (!draft.active) { clearStopwatches(); return; }
    const allowed = new Set(draft.exercises.flatMap(e => e.sets.filter(s => !s.done).map(s => s.id)));
    for (const id of Object.keys(runningStopwatches())) if (!allowed.has(id)) discardStopwatch(id);
    if (draft.pausedAt) pauseStopwatches(Date.parse(draft.pausedAt)); else resumeStopwatches();
    if (!storageReady) return;
    void saveStopwatches(accountId, sessionId, runningStopwatches())
      .catch(() => onPersistenceFailure('Set timer recovery could not be saved on this device. Keep the app open until the set is logged.'));
  }, [draft.pausedAt, draft.active, pendingSets, accountId, sessionId, storageReady, onPersistenceFailure]);

  useEffect(() => {
    if (!storageReady) return;
    return subscribeStopwatches(() => {
      // A persistence failure must be visible even though the timer can still run in memory.
      void saveStopwatches(accountId, sessionId, runningStopwatches())
        .catch(() => onPersistenceFailure('Set timer recovery could not be saved on this device. Keep the app open until the set is logged.'));
    });
  }, [accountId, sessionId, storageReady, onPersistenceFailure]);
}
