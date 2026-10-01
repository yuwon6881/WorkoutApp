import type { DraftExercise, DraftSet, DraftWorkout, Exercise, ImportDraft } from '../types';
import { demoUrlForName } from './demoLinks';

/// Which occurrences of a movement a saved exercise edit reaches. A block is the unit a
/// program prints a movement in, so it is the sensible default; the whole program is the wide end.
export type EditScope = 'occurrence' | 'block' | 'program';

export type SetChange = {
  /// Indices removed, in the order they apply to a copy of the other occurrence's sets.
  removed: number[];
  patches: { index: number; patch: Partial<DraftSet> }[];
  appended: DraftSet[];
};

/// What an edit changed on the fields that can reach other occurrences. A field that did not
/// change is absent, so applying it elsewhere never overwrites that occurrence's own value.
export type ExerciseChange = {
  library?: { exerciseId?: string | null; sourceName?: string; viaSubstitution: boolean };
  rest?: { restSeconds: number | null };
  notes?: { notes: string | null };
  sets?: SetChange;
};

export type Occurrence = { workoutLineId: string; exercise: DraftExercise };

/// What the exercise editor needs from whoever owns the draft document.
export type ExerciseEditing = {
  /// Commits an edited exercise; any scope beyond the occurrence reaches the others too.
  save: (base: DraftExercise, edited: DraftExercise, scope: EditScope) => Promise<void>;
  count: (base: DraftExercise) => { block: number; program: number };
  /// An import keeps the page's written name when a library exercise is picked, since the name
  /// is what groups the occurrences; a scratch program has no page, so the name follows the pick.
  keepWrittenName: boolean;
  /// Edits not saved yet, held above the day dialog so closing it cannot silently lose them.
  unsaved: Map<string, UnsavedExercise>;
};

export type UnsavedExercise = { base: string; draft: DraftExercise };

/// The fields an editor changes, as one comparable value.
export const editableSnapshot = (exercise: DraftExercise): string => JSON.stringify([
  exercise.sourceName, exercise.exerciseId, exercise.restSeconds ?? null, exercise.notes ?? '',
  exercise.sets, exercise.substitutions, exercise.demoUrl ?? null
]);

const MAX_SETS = 24;

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sameSet = (a: DraftSet, b: DraftSet) => sameValue(a, b);

function changedSetKeys(from: DraftSet, to: DraftSet): Partial<DraftSet> {
  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)] as (keyof DraftSet)[]);
  for (const key of keys) {
    if (!sameValue(from[key], to[key])) patch[key] = to[key] === undefined ? null : to[key];
  }
  return patch as Partial<DraftSet>;
}

/// Sets carry no identity, so a removal is located by the position whose absence leaves the
/// rows that remain most like the edited list.
function removalIndex(working: DraftSet[], next: DraftSet[]): number {
  let best = working.length - 1;
  let bestMatches = -1;
  for (let candidate = 0; candidate < working.length; candidate++) {
    const rest = working.filter((_, index) => index !== candidate);
    const matches = rest.reduce((count, set, index) => count + (index < next.length && sameSet(set, next[index]) ? 1 : 0), 0);
    // Identical rows tie, and trimming the last one is by far the likeliest edit.
    if (matches >= bestMatches) {
      best = candidate;
      bestMatches = matches;
    }
  }
  return best;
}

export function diffSets(base: DraftSet[], next: DraftSet[]): SetChange | null {
  const working = [...base];
  const removed: number[] = [];
  while (working.length > next.length) {
    const index = removalIndex(working, next);
    removed.push(index);
    working.splice(index, 1);
  }
  const patches: SetChange['patches'] = [];
  for (let index = 0; index < working.length; index++) {
    const patch = changedSetKeys(working[index], next[index]);
    if (Object.keys(patch).length > 0) patches.push({ index, patch });
  }
  const appended = next.slice(working.length);
  return removed.length || patches.length || appended.length ? { removed, patches, appended } : null;
}

export function diffExercise(base: DraftExercise, next: DraftExercise): ExerciseChange | null {
  const change: ExerciseChange = {};
  const idChanged = base.exerciseId !== next.exerciseId;
  const nameChanged = base.sourceName !== next.sourceName;
  if (idChanged || nameChanged) {
    change.library = {
      ...(idChanged ? { exerciseId: next.exerciseId } : {}),
      ...(nameChanged ? { sourceName: next.sourceName } : {}),
      viaSubstitution: idChanged && !sameValue(base.substitutions, next.substitutions)
    };
  }
  if ((base.restSeconds ?? null) !== (next.restSeconds ?? null)) change.rest = { restSeconds: next.restSeconds ?? null };
  if ((base.notes ?? '') !== (next.notes ?? '')) change.notes = { notes: next.notes };
  const sets = diffSets(base.sets, next.sets);
  if (sets) change.sets = sets;
  return Object.keys(change).length > 0 ? change : null;
}

/// The plain-language names of what changed, for the scope prompt's preview.
export function describeChange(change: ExerciseChange): string[] {
  return [
    change.library && 'library exercise',
    change.rest && 'rest timer',
    change.notes && 'notes',
    change.sets && 'sets and reps'
  ].filter((label): label is string => !!label);
}

/// A written movement's identity. The server publishes it on every save; a draft that has not
/// round-tripped yet (a scratch program) falls back to the written name.
const movementKey = (exercise: DraftExercise) =>
  exercise.movementKey || `name\u001f${exercise.sourceName.trim().toLowerCase().replace(/\s+/g, ' ')}`;

const blockOf = (workout: DraftWorkout) => workout.blockId ?? workout.block ?? '';

function locate(draft: ImportDraft, lineId: string): { workout: DraftWorkout; exercise: DraftExercise } | undefined {
  for (const workout of draft.workouts) {
    const exercise = workout.exercises.find(item => item.lineId === lineId);
    if (exercise) return { workout, exercise };
  }
  return undefined;
}

/// The other occurrences of the exercise as it was saved. A placeholder ("your choice") is a
/// single decision for the whole program, so the server key already spans blocks; the block
/// scope still narrows it to the block being edited.
export function findOccurrences(draft: ImportDraft, base: DraftExercise, scope: EditScope): Occurrence[] {
  if (scope === 'occurrence') return [];
  const home = locate(draft, base.lineId);
  if (!home) return [];
  const key = movementKey(base);
  const block = blockOf(home.workout);
  return draft.workouts.flatMap(workout => workout.isRestDay || (scope === 'block' && blockOf(workout) !== block)
    ? []
    : workout.exercises
      .filter(exercise => exercise.lineId !== base.lineId && movementKey(exercise) === key)
      .map(exercise => ({ workoutLineId: workout.lineId, exercise })));
}

export function countOccurrences(draft: ImportDraft, base: DraftExercise): { block: number; program: number } {
  return {
    block: findOccurrences(draft, base, 'block').length,
    program: findOccurrences(draft, base, 'program').length
  };
}

function applySetChange(sets: DraftSet[], change: SetChange): DraftSet[] {
  const next = sets.map(set => ({ ...set }));
  for (const index of change.removed) {
    if (index < next.length && next.length > 1) next.splice(index, 1);
  }
  for (const { index, patch } of change.patches) {
    if (index < next.length) next[index] = { ...next[index], ...patch };
  }
  for (const added of change.appended) {
    if (next.length < MAX_SETS) next.push({ ...added });
  }
  return next;
}

function applyLibraryChange(
  exercise: DraftExercise,
  change: NonNullable<ExerciseChange['library']>,
  library: Exercise[]
): DraftExercise {
  const next: DraftExercise = { ...exercise };
  if (change.exerciseId !== undefined) next.exerciseId = change.exerciseId;
  if (change.sourceName !== undefined) {
    next.sourceName = change.sourceName;
    next.demoUrl = demoUrlForName(exercise.demoLinks, change.sourceName);
  }
  if (change.viaSubstitution && change.exerciseId !== undefined) {
    const replacement = library.find(item => item.id === change.exerciseId);
    const previous = library.find(item => item.id === exercise.exerciseId)?.name ?? exercise.sourceName;
    next.substitutions = [previous, ...exercise.substitutions.filter(name => name.toLowerCase() !== replacement?.name.toLowerCase())].slice(0, 2);
  }
  return next;
}

/// Carries only the changed fields onto another occurrence, leaving everything it prescribes
/// for itself (its own sets, RIR taper, rest and notes) alone.
export function applyChange(exercise: DraftExercise, change: ExerciseChange, library: Exercise[]): DraftExercise {
  let next = exercise;
  if (change.library) next = applyLibraryChange(next, change.library, library);
  if (change.rest) next = { ...next, restSeconds: change.rest.restSeconds };
  if (change.notes) next = { ...next, notes: change.notes.notes };
  if (change.sets) next = { ...next, sets: applySetChange(next.sets, change.sets) };
  return next;
}

/// Commits an edited exercise and carries its changes to the occurrences the scope reaches.
export function applyExerciseEdit(
  draft: ImportDraft,
  base: DraftExercise,
  edited: DraftExercise,
  scope: EditScope,
  library: Exercise[]
): ImportDraft {
  const change = diffExercise(base, edited);
  const reached = new Map(change ? findOccurrences(draft, base, scope).map(item => [item.exercise.lineId, item.exercise]) : []);
  return {
    ...draft,
    workouts: draft.workouts.map(workout => ({
      ...workout,
      exercises: workout.exercises.map(exercise => {
        if (exercise.lineId === edited.lineId) return edited;
        return change && reached.has(exercise.lineId) ? applyChange(exercise, change, library) : exercise;
      })
    }))
  };
}
