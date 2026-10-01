import { useEffect, useState } from 'react';
import type { DraftExercise } from '../types';
import { editableSnapshot, type UnsavedExercise } from '../lib/exerciseEditScope';

/// An exercise's edits, held apart from the saved exercise until the lifter saves them.
///
/// Edits are layered over whatever is saved at the time, so a save elsewhere (or the server
/// re-normalising a row) never discards them. Unsaved edits are mirrored into `unsaved`, which
/// lives above the day dialog: the dialog can close and reopen without losing them. A held draft
/// is only restored while the saved exercise is still the one it was made from.
export function useExerciseDraft(saved: DraftExercise, unsaved: Map<string, UnsavedExercise>) {
  const baseSnapshot = editableSnapshot(saved);
  const held = unsaved.get(saved.lineId);
  const [draft, setDraft] = useState<DraftExercise | null>(held && held.base === baseSnapshot ? held.draft : null);

  // Only the editable fields come from the draft. Superset pairing and the rest of the row's
  // identity are changed outside this editor, so they always follow the saved exercise.
  const exercise: DraftExercise = draft
    ? {
      ...saved,
      sourceName: draft.sourceName, exerciseId: draft.exerciseId, restSeconds: draft.restSeconds,
      notes: draft.notes, sets: draft.sets, substitutions: draft.substitutions, demoUrl: draft.demoUrl
    }
    : saved;
  const dirty = draft !== null && editableSnapshot(exercise) !== baseSnapshot;

  useEffect(() => {
    if (dirty) unsaved.set(saved.lineId, { base: baseSnapshot, draft: exercise });
    else unsaved.delete(saved.lineId);
  });

  return {
    exercise,
    dirty,
    setExercise: (next: DraftExercise) => setDraft(next),
    /// Drops the edits, after they were saved or when the lifter cancels them.
    discard: () => setDraft(null),
    /// A slow save must not clear edits the lifter typed after submitting it.
    acknowledgeSave: (submitted: DraftExercise) => setDraft(current =>
      current && editableSnapshot(current) !== editableSnapshot(submitted) ? current : null)
  };
}
