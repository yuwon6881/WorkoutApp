import type { Session } from '../types';
import { discardStopwatch, runningStopwatches, type RunningStopwatch } from './setStopwatch';

/** Completion records a duration, never an implicit set log. Keep timers until the edit is durable. */
export function withFinishedSetTimers(draft: Session, timers = runningStopwatches()): Session {
  let changed = false;
  const exercises = draft.exercises.map(exercise => ({ ...exercise, sets: exercise.sets.map(set => {
    const seconds = timers[set.id]?.finishedSeconds;
    if (seconds === undefined || set.done || set.durationSeconds === seconds) return set;
    changed = true;
    return { ...set, durationSeconds: seconds };
  }) }));
  return changed ? { ...draft, exercises } : draft;
}

export function acknowledgeFinishedSetTimers(draft: Session, timers: Record<string, RunningStopwatch>) {
  const current = runningStopwatches();
  for (const set of draft.exercises.flatMap(exercise => exercise.sets)) {
    const timer = timers[set.id];
    if (timer?.finishedSeconds !== undefined && set.durationSeconds === timer.finishedSeconds && current[set.id] === timer)
      discardStopwatch(set.id);
  }
}
