import type { Exercise, LoggedSet } from '../types';

type ResistanceMode = NonNullable<LoggedSet['resistanceMode']>;
type Named = { name: string; loadModel?: Exercise['loadModel'] };

const ASSISTED = /\bassist(?:ed|ance)?\b/i;
const WEIGHTED = /\bweighted\b/i;

/// A bodyweight movement's name already says how it is loaded: "Weighted Pull-Up" adds load,
/// "Assisted Dip" takes some away, and a plain "Pull-Up" is bodyweight alone. The lifter never
/// picks the mode per set. Mirrors ResistanceModes.ForExercise on the server.
export function resistanceModeFor(loadModel: Exercise['loadModel'] | undefined, name: string): ResistanceMode {
  if (loadModel === 'full_bodyweight') return ASSISTED.test(name) ? 'assistance' : WEIGHTED.test(name) ? 'added' : 'bodyweight';
  return loadModel === 'bodyweight_context_only' || loadModel === 'reps_only' ? 'reps_only' : 'external';
}

/// How the load field reads. An assisted machine logged as an external load still gets the
/// assistance treatment, since a bigger number there also means an easier set.
export type LoadEntry = 'external' | 'added' | 'assistance' | 'bodyweight' | 'none';

export function loadEntryFor(exercise: Named): LoadEntry {
  const mode = resistanceModeFor(exercise.loadModel ?? 'external', exercise.name);
  if (mode === 'reps_only') return 'none';
  if (mode === 'external') return ASSISTED.test(exercise.name) ? 'assistance' : 'external';
  return mode;
}

/// The sign in front of a load: added weight is "+", assistance subtracts from bodyweight.
export const loadSign = (entry: LoadEntry): string => entry === 'added' ? '+' : entry === 'assistance' ? '−' : '';

/// The load column's heading, so the number below it is never read as the wrong kind of weight.
export function loadColumnLabel(entry: LoadEntry, unit: string): string {
  if (entry === 'assistance') return 'Assist';
  if (entry === 'bodyweight') return 'BW';
  return `${loadSign(entry)}${unit.toUpperCase()}`;
}

/// What the load field is called for a screen reader, in the same words as the column.
export function loadFieldName(entry: LoadEntry): string {
  if (entry === 'added') return 'added weight';
  if (entry === 'assistance') return 'assistance weight, more is easier';
  if (entry === 'bodyweight') return 'bodyweight, no load to enter';
  return 'weight';
}
