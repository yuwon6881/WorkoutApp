import type { Exercise, Unit } from '../types';
import { showExerciseWeight } from './weightBasis';

/// A planned set's load as Start would pre-fill it (`GET /api/templates/{id}/start-preview`).
export type StartPreviewSet = { position: number; warmup: boolean; weightKg: number | null; resistanceMode: string };
export type StartPreviewExercise = { templateExerciseId: string; sets: StartPreviewSet[] };

/// The load shown beside a set, or null when there is nothing honest to say: an unknown load stays
/// absent, and bodyweight or reps-only sets have no entered load. Added and assisted loads say which
/// way they count, as the workout's own load field does.
export function previewLoadLabel(set: StartPreviewSet, unit: Unit, exercise: Pick<Exercise, 'weightBasis'>): string | null {
  if (set.weightKg == null) return null;
  if (set.weightKg <= 0 && set.resistanceMode !== 'external') return null;
  if (set.resistanceMode === 'bodyweight' || set.resistanceMode === 'reps_only') return null;
  const shown = showExerciseWeight(set.weightKg, unit, exercise);
  if (set.resistanceMode === 'added') return `+${shown}`;
  if (set.resistanceMode === 'assistance') return `${shown} assist`;
  return shown;
}

/// Load labels by planned set position for each template exercise, keyed by the line id the day uses.
export function previewLoadsByLine(
  previews: readonly StartPreviewExercise[],
  catalogByLine: ReadonlyMap<string, Pick<Exercise, 'weightBasis'> | undefined>,
  unit: Unit
): Map<string, (string | null)[]> {
  const result = new Map<string, (string | null)[]>();
  for (const preview of previews) {
    const idKey = preview.templateExerciseId.toLowerCase();
    const exercise = catalogByLine.get(preview.templateExerciseId) ?? catalogByLine.get(idKey) ?? {};
    const labels: (string | null)[] = [];
    for (const set of preview.sets) labels[set.position] = previewLoadLabel(set, unit, exercise);
    result.set(preview.templateExerciseId, labels);
    result.set(idKey, labels);
  }
  return result;
}
