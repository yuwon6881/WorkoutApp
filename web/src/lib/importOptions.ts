import type { DraftExercise, DraftSet, Exercise, ImportDraft, ImportOption, ImportUncertainty } from '../types';
import { applyExerciseEdit } from './exerciseEditScope';

/// Where a flagged detail sits: an exercise, or one of its sets when setIndex is given.
export type OptionTarget = { workoutLineId?: string | null; exerciseLineId?: string | null; setIndex?: number | null };

function locate(draft: ImportDraft, target: OptionTarget): DraftExercise | null {
  return draft.workouts.find(day => day.lineId === target.workoutLineId)
    ?.exercises.find(exercise => exercise.lineId === target.exerciseLineId) ?? null;
}

function uncertaintyAt(exercise: DraftExercise, setIndex: number | null | undefined): ImportUncertainty | null | undefined {
  return setIndex === null || setIndex === undefined ? exercise.uncertainty : exercise.sets[setIndex]?.uncertainty;
}

/// The answers the assistant offered for a flagged detail, none when it left the choice to the user.
export function optionsAt(draft: ImportDraft, target: OptionTarget): ImportOption[] {
  const exercise = locate(draft, target);
  const uncertainty = exercise ? uncertaintyAt(exercise, target.setIndex) : null;
  return uncertainty?.flag ? uncertainty.options ?? [] : [];
}

/// A movement option reads as the library's own name for it; a reps or effort option reads as the assistant wrote it.
export function optionLabel(option: ImportOption, library: readonly Exercise[]): string {
  return (option.exerciseId ? library.find(item => item.id === option.exerciseId)?.name : null) ?? option.label;
}

const settled = (uncertainty: ImportUncertainty): ImportUncertainty => ({ flag: false, reason: uncertainty.reason ?? null });

function mapMovement(draft: ImportDraft, exercise: DraftExercise, option: ImportOption, library: Exercise[]): ImportDraft {
  const chosen = option.exerciseId!;
  const mapped = applyExerciseEdit(draft, exercise, { ...exercise, exerciseId: chosen }, 'program', library);
  // Each occurrence the assistant flagged offered the same question; the answer settles every one it mapped.
  return {
    ...mapped,
    workouts: mapped.workouts.map(day => ({
      ...day,
      exercises: day.exercises.map(item => item.exerciseId === chosen && item.uncertainty?.flag
        && item.uncertainty.options?.some(offered => offered.exerciseId === chosen)
        ? { ...item, uncertainty: settled(item.uncertainty) } : item)
    }))
  };
}

function setReps(set: DraftSet, option: ImportOption): DraftSet {
  return {
    ...set,
    ...(option.repMin != null && option.repMax != null ? { repMin: option.repMin, repMax: option.repMax } : {}),
    ...(option.targetRpe != null ? { targetRpe: option.targetRpe } : {}),
    uncertainty: set.uncertainty ? settled(set.uncertainty) : set.uncertainty
  };
}

/// The draft with one offered answer applied, or null when it cannot be (a stale target, an option with nothing to apply).
export function applyImportOption(draft: ImportDraft, target: OptionTarget, option: ImportOption, library: Exercise[]): ImportDraft | null {
  const exercise = locate(draft, target);
  if (!exercise) return null;
  if (target.setIndex === null || target.setIndex === undefined) return option.exerciseId ? mapMovement(draft, exercise, option, library) : null;
  const index = target.setIndex;
  if (!exercise.sets[index] || (option.repMin == null && option.targetRpe == null)) return null;
  const sets = exercise.sets.map((set, position) => position === index ? setReps(set, option) : set);
  return {
    ...draft,
    workouts: draft.workouts.map(day => ({
      ...day,
      exercises: day.exercises.map(item => item.lineId === exercise.lineId ? { ...item, sets } : item)
    }))
  };
}
