import { useEffect, useState } from 'react';
import type { RecentExerciseSession, SessionExercise } from '../types';
import { api } from '../lib/api';

export type RecentSetsStatus = 'loading' | 'ready' | 'failed';

/// The last few finished sessions of an exercise, read from the account-authorized API and kept in
/// component memory only. Until it loads, offline, or for an exercise outside the library the list
/// is empty and callers fall back to the plan's targets rather than showing an error; the status
/// lets them say whether last time is still loading, absent, or could not be read.
export function useRecentExerciseSets(exerciseId: SessionExercise['exerciseId']): { sessions: RecentExerciseSession[]; status: RecentSetsStatus } {
  const [sessions, setSessions] = useState<RecentExerciseSession[]>([]);
  const [status, setStatus] = useState<RecentSetsStatus>(exerciseId ? 'loading' : 'ready');

  useEffect(() => {
    setSessions([]);
    setStatus(exerciseId ? 'loading' : 'ready');
    if (!exerciseId) return;
    const controller = new AbortController();
    api.recentExerciseSets(exerciseId, controller.signal)
      .then(rows => {
        if (controller.signal.aborted) return;
        setSessions(rows);
        setStatus('ready');
      })
      // History is a convenience; the plan's targets stay on screen and the row says it is unavailable.
      .catch(() => { if (!controller.signal.aborted) setStatus('failed'); });
    return () => controller.abort();
  }, [exerciseId]);

  return { sessions, status };
}
