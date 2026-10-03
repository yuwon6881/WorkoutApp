import { useEffect } from 'react';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import { saveStopwatches } from '../lib/workoutRecovery';
import { restoreStopwatches, runningStopwatches, subscribeStopwatches } from '../lib/setStopwatch';

/// Timed sets count in memory so a hold keeps going across exercise pages. This keeps a copy with
/// the workout's device recovery as each one starts or stops, and picks the copy back up when the
/// workout reopens after the app was closed or crashed, so the hold resumes from its real start.
export function useStopwatchRecovery(accountId: string, sessionId: string, recovery: WorkoutRecoveryRecord | null) {
  const saved = recovery?.sessionId === sessionId ? recovery.stopwatches : undefined;

  useEffect(() => {
    if (saved) restoreStopwatches(saved);
    // Only the copy found when the workout opens: later copies are this screen's own saves.
  }, [sessionId]);

  useEffect(() => subscribeStopwatches(() => {
    // Recovery is best effort here: a hold that cannot be kept still counts while the app is open.
    void saveStopwatches(accountId, sessionId, runningStopwatches()).catch(() => undefined);
  }), [accountId, sessionId]);
}
