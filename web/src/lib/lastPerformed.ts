import type { Unit } from '../types';
import { showExerciseWeight, type WithWeightBasis } from './weightBasis';

/** The top working set of an exercise's most recent finished workout, as the API reports it. */
export type ExerciseLastPerformed = {
  exerciseId: string;
  finishedAt: string;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
};

/// "Last: 100 kg × 8 · Oct 27": load and reps when both are known, otherwise whichever was logged.
/// Null when the set recorded nothing worth repeating back.
export function lastPerformedLabel(last: ExerciseLastPerformed, unit: Unit, exercise: WithWeightBasis, locale?: string): string | null {
  const load = last.weightKg !== null ? showExerciseWeight(last.weightKg, unit, exercise) : null;
  const effort = last.reps !== null ? `${last.reps}` : last.durationSeconds !== null ? `${last.durationSeconds} s` : null;
  const set = load && effort ? `${load} × ${effort}` : load ?? (effort && last.reps !== null ? `${effort} reps` : effort);
  if (!set) return null;
  const date = new Date(last.finishedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return `Last: ${set} · ${date}`;
}
