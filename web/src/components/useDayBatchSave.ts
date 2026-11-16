import { useCallback, useState } from 'react';
import type { DraftExercise } from '../types';
import type { ExerciseEditing } from '../lib/exerciseEditScope';
import { needsReview, pendingEdits, type ExerciseEdit, type PendingEdit } from '../lib/exerciseBatchEdit';
import { UnsavedExercises } from '../lib/unsavedExercises';

/// Saving everything edited on the open day together. The day's held edits live here, above the
/// dialog; saving them asks where they should reach once, and only when something could reach
/// another occurrence, and then writes them in a single revision-checked save.
export function useDayBatchSave(dayExercises: DraftExercise[], editing: Omit<ExerciseEditing, 'unsaved'>) {
  const [unsavedCount, setUnsavedCount] = useState(0);
  const [unsaved] = useState(() => new UnsavedExercises(setUnsavedCount));
  const [review, setReview] = useState<PendingEdit[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(async (edits: ExerciseEdit[]) => {
    setSaving(true);
    setError(null);
    try {
      await editing.saveAll(edits);
      setReview(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save these exercises.');
    } finally {
      setSaving(false);
    }
  }, [editing]);

  const requestSave = useCallback(() => {
    const pending = pendingEdits(dayExercises, unsaved, editing.count);
    if (pending.length === 0) return;
    setError(null);
    if (needsReview(pending)) setReview(pending);
    else void commit(pending.map(item => ({ base: item.base, edited: item.edited, scope: 'occurrence' as const })));
  }, [commit, dayExercises, editing, unsaved]);

  const cancelReview = useCallback(() => {
    setReview(null);
    setError(null);
  }, []);

  return { unsaved, unsavedCount, review, saving, error, requestSave, confirmReview: commit, cancelReview };
}
