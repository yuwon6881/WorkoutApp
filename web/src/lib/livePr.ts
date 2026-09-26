import type { LoggedSet, SessionExercise } from '../types';
import { calculateEstimated1Rm } from './training';

// The same rule the server uses when the workout is saved (WorkoutViewBuilder.ComputePrs): a
// working set's estimated 1RM, on system load for full-bodyweight movements, has to beat the
// best of every finished session. Here it must also beat the sets already logged today, so the
// lifter hears about each improvement once. Without finished history there is nothing to beat.
export function setEstimate(exercise: SessionExercise, set: LoggedSet): number | null {
  if (set.warmup) return null;
  const load = exercise.loadModel === 'full_bodyweight' ? set.systemLoadKg ?? set.weightKg : set.weightKg;
  return calculateEstimated1Rm(load, set.reps, set.rpe);
}

export function newBestAfterLogging(exercise: SessionExercise, setIndex: number): number | null {
  const previous = exercise.previousBestE1rmKg;
  const set = exercise.sets[setIndex];
  if (previous == null || !set) return null;
  const estimate = setEstimate(exercise, set);
  if (estimate === null || estimate <= previous + 1e-4) return null;
  const earlierToday = exercise.sets
    .filter((other, index) => index !== setIndex && other.done)
    .map(other => setEstimate(exercise, other) ?? 0);
  return earlierToday.some(value => value >= estimate - 1e-4) ? null : estimate;
}
