import type { DraftExercise, Exercise, ImportDraft } from '../types';
import {
  applyExerciseEdit,
  describeChange,
  diffExercise,
  editableSnapshot,
  type EditScope,
  type UnsavedExercise
} from './exerciseEditScope';

/// Several exercises of one day saved together, so the lifter is asked where their changes should
/// reach once, at the end, instead of once per exercise.
export type ExerciseEdit = { base: DraftExercise; edited: DraftExercise; scope: EditScope };

export type PendingEdit = {
  /// The exercise as last saved.
  base: DraftExercise;
  /// The saved exercise with the held edits laid over it.
  edited: DraftExercise;
  /// What changed, in plain language.
  changes: string[];
  /// How many other occurrences the block and the whole program hold.
  counts: { block: number; program: number };
};

/// Only the editable fields come from the held draft; superset pairing and the rest of the row's
/// identity are changed outside the editor, so they always follow the saved exercise.
export function mergeEditedFields(saved: DraftExercise, draft: DraftExercise): DraftExercise {
  return {
    ...saved,
    sourceName: draft.sourceName, exerciseId: draft.exerciseId, restSeconds: draft.restSeconds,
    notes: draft.notes, sets: draft.sets, substitutions: draft.substitutions, demoUrl: draft.demoUrl
  };
}

/// The day's held edits, in the order the exercises appear. An edit made from an exercise that has
/// since been saved differently is stale and an edit that no longer differs has nothing to save;
/// both are left out.
export function pendingEdits(
  saved: DraftExercise[],
  unsaved: ReadonlyMap<string, UnsavedExercise>,
  count: (base: DraftExercise) => { block: number; program: number }
): PendingEdit[] {
  return saved.flatMap(base => {
    const held = unsaved.get(base.lineId);
    if (!held || held.base !== editableSnapshot(base)) return [];
    const edited = mergeEditedFields(base, held.draft);
    const change = diffExercise(base, edited);
    return change ? [{ base, edited, changes: describeChange(change), counts: count(base) }] : [];
  });
}

/// Whether the lifter has anything to decide: an edit to an exercise that appears only once has
/// nowhere else to go, as when saving a single exercise.
export const needsReview = (pending: PendingEdit[]): boolean => pending.some(item => item.counts.program > 0);

/// The block is the unit a program prints a movement in, so it is the default when anything has company there.
export const reviewDefaultScope = (pending: PendingEdit[]): EditScope =>
  pending.some(item => item.counts.block > 0) ? 'block' : 'occurrence';

/// Applies every edit to one draft, so a single write carries them all and none rewrites another.
export function applyExerciseEdits(
  draft: ImportDraft, edits: ExerciseEdit[], library: Exercise[], frozenDayIds?: ReadonlySet<string>
): ImportDraft {
  return edits.reduce((current, edit) => applyExerciseEdit(current, edit.base, edit.edited, edit.scope, library, frozenDayIds), draft);
}
