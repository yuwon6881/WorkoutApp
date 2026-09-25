import type { ExerciseCategory } from '../types';

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
