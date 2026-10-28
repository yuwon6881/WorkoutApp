import type { DraftExercise } from '../types';

/** Time under the bar per set, a rough allowance; the estimate is labelled approximate. */
const SECONDS_PER_SET = 40;

/// Approximate minutes for a planned day: each set's work, the rest after every set but an
/// exercise's last, and one rest to move between exercises. Rest comes from the set, then the
/// exercise, then the account default. Rounded to five minutes, since it is a guess; null when
/// nothing is planned.
export function estimateWorkoutMinutes(exercises: DraftExercise[], defaultRestSeconds: number): number | null {
  let seconds = 0;
  let sets = 0;
  exercises.forEach((exercise, index) => {
    exercise.sets.forEach((set, position) => {
      sets++;
      seconds += SECONDS_PER_SET;
      const last = position === exercise.sets.length - 1;
      if (!last) seconds += set.restSeconds ?? exercise.restSeconds ?? defaultRestSeconds;
    });
    if (index < exercises.length - 1 && exercise.sets.length) seconds += defaultRestSeconds;
  });
  if (!sets) return null;
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}
