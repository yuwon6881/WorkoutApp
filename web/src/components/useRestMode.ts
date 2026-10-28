import { useState } from 'react';
import type { SessionExercise } from '../types';
import { sessionHasRestRange, type RestMode } from '../lib/restRange';
import { exerciseRestSeconds, restSecondsAfter } from '../lib/restRules';

/// The session's rest preference for imported rest ranges. It lives in component state only, so
/// every workout starts balanced and the user is never asked to choose; a rest that is already
/// running keeps its deadline, and the choice only shapes the rests that start after it.
export function useRestMode(exercises: readonly SessionExercise[], accountDefault: number) {
  const [mode, setMode] = useState<RestMode>('balanced');
  return {
    mode,
    accountDefault,
    secondsAfter: (exercise: SessionExercise, setIndex: number) => restSecondsAfter(exercise, setIndex, accountDefault, mode),
    exerciseSeconds: (exercise: SessionExercise) => exerciseRestSeconds(exercise, accountDefault, mode),
    /** Props for the top bar's rest selector, which only appears when the plan prints a range. */
    topBarProps: { restMode: mode, onRestModeChange: setMode, showRestMode: sessionHasRestRange(exercises) }
  };
}
