import type { Exercise, SessionExercise } from '../types';
import { getPlannedMuscleCredits, type PlannedMuscleSummary } from './programMuscles';

/**
 * The muscles a finished session trained. Only logged working sets earn credit, with the same
 * primary/secondary weights the Muscles map and program previews use, so one session reads the
 * same here as it does inside its week.
 */
export function getSessionMuscleCredits(
  exercises: Pick<SessionExercise, 'exerciseId' | 'name' | 'sets'>[],
  catalog: Exercise[]
): PlannedMuscleSummary {
  return getPlannedMuscleCredits(exercises.map(exercise => ({
    exerciseId: exercise.exerciseId,
    sourceName: exercise.name,
    sets: exercise.sets.filter(set => set.done).map(set => ({ warmup: set.warmup }))
  })), catalog);
}
