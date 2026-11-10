import type { DraftExercise, Exercise } from '../types';
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
export function selectDraftExercise(exercise: DraftExercise, replacement: Exercise, library: Exercise[], keepWrittenName: boolean): DraftExercise {
  const swapping = !!exercise.exerciseId && exercise.exerciseId !== replacement.id;
  const sourceName = swapping || !keepWrittenName ? replacement.name : exercise.sourceName;
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
