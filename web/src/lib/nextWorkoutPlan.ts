import type { Exercise, Template, Unit } from '../types';
import { templateToDraft } from './activeSlot';
import { lastPerformedSet, type ExerciseLastPerformed } from './lastPerformed';
import { estimateWorkoutMinutes } from './workoutEstimate';

export type NextWorkoutPlanRow = { key: string; name: string; last: string | null };
export type NextWorkoutPlan = { minutes: number | null; rows: NextWorkoutPlanRow[]; more: number };

/// The Overview hero's glimpse of the next workout: its estimated length at the planned rests and
/// its first few exercises, each with the last top set logged for it. The last set is history, never
/// a target, and stays absent when the movement has none.
export function nextWorkoutPlan(
  template: Template,
  lastPerformed: ReadonlyMap<string, ExerciseLastPerformed>,
  catalog: readonly Exercise[],
  unit: Unit,
  defaultRestSeconds: number,
  shown = 3
): NextWorkoutPlan {
  const day = templateToDraft(template);
  const byId = new Map(catalog.map(exercise => [exercise.id, exercise]));
  const rows = day.exercises.slice(0, shown).map(exercise => {
    const last = exercise.exerciseId ? lastPerformed.get(exercise.exerciseId) : undefined;
    const known = exercise.exerciseId ? byId.get(exercise.exerciseId) : undefined;
    return {
      key: exercise.lineId,
      name: exercise.sourceName,
      last: last ? lastPerformedSet(last, unit, known ?? {}) : null
    };
  });
  return {
    minutes: estimateWorkoutMinutes(day.exercises, defaultRestSeconds),
    rows,
    more: Math.max(0, day.exercises.length - rows.length)
  };
}
