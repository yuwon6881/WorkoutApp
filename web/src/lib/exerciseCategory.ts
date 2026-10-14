import type { ExerciseCategory } from '../types';

function letters(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

/// The equipment worth printing beside an exercise, or null when it says nothing the category
/// does not. "Bodyweight" under Body Weight and "Machine" under Machine are the same fact twice;
/// a blank equipment is left out rather than shown as a placeholder.
export function informativeEquipment(exercise: { category?: string; equipment?: string; loadModel?: string }): string | null {
  const equipment = (exercise.equipment ?? '').trim();
  if (!equipment) return null;
  return letters(equipment) === letters(getExerciseCategory(exercise)) ? null : equipment;
}

export function getExerciseCategory(exercise: { category?: string; equipment?: string; loadModel?: string }): ExerciseCategory {
  if (exercise.category === 'Free Weights' || exercise.category === 'Machine' || exercise.category === 'Body Weight') {
    return exercise.category;
  }
  const equipment = (exercise.equipment ?? '').trim().toLowerCase();
  if (equipment === 'bodyweight' || equipment === 'band' || exercise.loadModel === 'full_bodyweight'
    || exercise.loadModel === 'bodyweight_context_only' || exercise.loadModel === 'reps_only') {
    return 'Body Weight';
  }
  if (equipment === 'machine' || equipment === 'smith machine' || equipment === 'cable') {
    return 'Machine';
  }
  return 'Free Weights';
}
