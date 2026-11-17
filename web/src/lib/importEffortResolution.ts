import type { DraftExercise } from '../types';
import { cleanTechniqueNotes, getSetType } from './importSetTypes';

const clarification = 'Use the listed effort targets for these sets. Source note: ';

/// Preserve the source and each target, while making the chosen instruction clear in the program.
/// Leave mixed or unspecified effort prescriptions for manual review.
export function useListedEffort(exercise: DraftExercise): DraftExercise | null {
  const working = exercise.sets.filter(set => !set.warmup);
  if (!working.length || clarification.length + (exercise.notes?.length ?? 0) > 1000) return null;
  const reserves = working.map(set => {
    const rir = set.rir?.trim();
    if (rir && !/^\d+(?:\.\d+)?$/.test(rir)) return null;
    const fromRir = rir ? Number(rir) : null;
    const fromRpe = set.targetRpe == null ? null : 10 - set.targetRpe;
    if (fromRir !== null && (fromRir > 10 || (fromRpe !== null && Math.abs(fromRir - fromRpe) > 0.001))) return null;
    return fromRir ?? fromRpe;
  });
  if (reserves.some(value => value === null || value < 0) || !reserves.some(value => value !== null && value > 0)) return null;
  if (working.some((set, index) => (reserves[index] ?? 0) > 0 && getSetType(set) === 'amrap'
    && getSetType({ ...set, notes: cleanTechniqueNotes(set.notes) }) === 'amrap')) return null;
  let index = 0;
  return {
    ...exercise,
    notes: clarification + (exercise.notes ?? ''),
    sets: exercise.sets.map(set => {
      if (set.warmup) return set;
      const reserve = reserves[index++];
      return reserve !== null && reserve > 0 && getSetType(set) === 'amrap'
        ? { ...set, notes: cleanTechniqueNotes(set.notes) }
        : set;
    })
  };
}
