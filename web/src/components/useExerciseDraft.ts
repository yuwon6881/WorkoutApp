import { useEffect, useState } from 'react';
import type { DraftExercise } from '../types';
import { editableSnapshot, type UnsavedExercise } from '../lib/exerciseEditScope';
import { mergeEditedFields } from '../lib/exerciseBatchEdit';

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

  const exercise: DraftExercise = draft ? mergeEditedFields(saved, draft) : saved;
  const dirty = draft !== null && editableSnapshot(exercise) !== baseSnapshot;

  useEffect(() => {
    if (dirty) unsaved.set(saved.lineId, { base: baseSnapshot, draft: exercise });
    else unsaved.delete(saved.lineId);
  });

  // Saved by the day's combined save, or typed back to what is saved: a draft that no longer
  // differs is dropped, or it would keep masking what is saved from then on.
  useEffect(() => {
    if (draft && !dirty) setDraft(null);
  }, [draft, dirty]);

  return {
    exercise,
    dirty,
    setExercise: (next: DraftExercise) => setDraft(next),
    /// Drops the held edits, as Restore default does when the exercise has no saved default.
    discard: () => setDraft(null)
  };
}
