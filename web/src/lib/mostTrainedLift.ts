import type { ProgressExercise } from '../types';

/**
 * The lift the user has trained in the most sessions, for naming a suggested question. Only lifts
 * with a strength estimate qualify, so a mobility drill never stands in for "strength progress".
 * Ties go to the heavier total volume, then the name, so the pick does not flicker between loads.
 */
export function mostTrainedLift(exercises: readonly ProgressExercise[] | undefined): string | null {
  const lifts = (exercises ?? []).filter(exercise => exercise.exerciseId !== null && exercise.estimatedMaxKg !== null && exercise.sessions > 0);
  if (lifts.length === 0) return null;
  const best = [...lifts].sort((a, b) =>
    b.sessions - a.sessions
    || (b.volumeKg ?? 0) - (a.volumeKg ?? 0)
    || a.exercise.localeCompare(b.exercise))[0];
  return best.exercise;
}
