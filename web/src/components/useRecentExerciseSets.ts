import { useEffect, useState } from 'react';
import type { RecentExerciseSession, SessionExercise } from '../types';
import { api } from '../lib/api';

/// The last few finished sessions of an exercise, read from the account-authorized API and kept in
/// component memory only. Until it loads, offline, or for an exercise outside the library the list
/// is empty and callers fall back to the plan's targets rather than showing an error.
export function useRecentExerciseSets(exerciseId: SessionExercise['exerciseId']): RecentExerciseSession[] {
  const [sessions, setSessions] = useState<RecentExerciseSession[]>([]);

  useEffect(() => {
    setSessions([]);
    if (!exerciseId) return;
    const controller = new AbortController();
    api.recentExerciseSets(exerciseId, controller.signal)
      .then(rows => { if (!controller.signal.aborted) setSessions(rows); })
      .catch(() => { /* history is a convenience; the plan's targets stay on screen */ });
    return () => controller.abort();
  }, [exerciseId]);

  return sessions;
}
