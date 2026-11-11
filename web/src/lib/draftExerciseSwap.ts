import type { CustomExerciseCreated, DraftExercise, Exercise } from '../types';
import { demoUrlForName } from './demoLinks';
import { MAX_SUBSTITUTIONS } from './validation';

const key = (name: string) => name.trim().toLocaleLowerCase();
export function resolveExercise(name: string, library: Exercise[]): Exercise | undefined {
  return library.find(item => [item.name, ...item.aliases].some(value => key(value) === key(name)));
}
export function displayExerciseName(name: string, library: Exercise[]): string {
  const canonical = resolveExercise(name, library)?.name ?? name;
  return canonical.replace(/^\p{L}/u, letter => letter.toLocaleUpperCase());
}
/** The name the builder gives a row the user adds. Keep in step with `IsAddedPlaceholder` on the server. */
export const isPlaceholderName = (name: string): boolean => /^\s*new\s+exercise\s*$/i.test(name);

/**
 * A written movement's identity when the server has not published one. An added, unrenamed row is
 * its own movement, so it is keyed by the row rather than by a name that says nothing about it.
 */
export function writtenMovementKey(exercise: Pick<DraftExercise, 'lineId' | 'sourceName' | 'movementKey'>): string {
  if (exercise.movementKey) return exercise.movementKey;
  if (isPlaceholderName(exercise.sourceName)) return `row\u001f${exercise.lineId}`;
  return `name\u001f${exercise.sourceName.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export function selectDraftExercise(exercise: DraftExercise, replacement: Exercise, library: Exercise[], keepWrittenName: boolean): DraftExercise {
  const swapping = !!exercise.exerciseId && exercise.exerciseId !== replacement.id;
  const sourceName = swapping || !keepWrittenName || isPlaceholderName(exercise.sourceName) ? replacement.name : exercise.sourceName;
  const next = { ...exercise, exerciseId: replacement.id, sourceName, demoUrl: demoUrlForName(exercise.demoLinks, sourceName) };
  if (!swapping) return next;
  const previous = library.find(item => item.id === exercise.exerciseId)?.name ?? exercise.sourceName;
  const seen = new Set([replacement.id, key(replacement.name)]);
  next.substitutions = [previous, ...(exercise.substitutions ?? [])].filter(name => {
    const match = resolveExercise(name, library);
    const identity = match?.id ?? key(name);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, MAX_SUBSTITUTIONS);
  return next;
}

/** A custom exercise as the server returned it, in the library's shape, before the library reloads. */
export function customAsExercise(created: CustomExerciseCreated): Exercise {
  return {
    id: created.id, slug: `exercise-${created.id}`, name: created.name, muscle: created.muscle,
    secondaryMuscles: created.secondaryMuscles, equipment: created.equipment, category: created.category,
    aliases: [], loadStepKg: created.loadStepKg, loadModel: created.loadModel, weightBasis: created.weightBasis,
    movementPattern: created.movementPattern, source: 'custom', isCustom: true, archived: created.archived
  };
}

/** Keep written names as import provenance, but show the linked catalog name in program views. */
export function draftExerciseName(exercise: DraftExercise, library: Exercise[]): string {
  return library.find(item => item.id === exercise.exerciseId)?.name ?? exercise.sourceName;
}
