import { useState } from 'react';
import type { DraftExercise } from '../types';
import { describeChange, diffExercise, type EditScope, type ExerciseEditing } from '../lib/exerciseEditScope';

type ScopeRequest = { changes: string[]; counts: { block: number; program: number } };

/// Saving an edited exercise: commit it straight away when nothing else would be affected, and
/// otherwise ask which occurrences the change should reach.
export function useExerciseSave(saved: DraftExercise, edited: DraftExercise, editing: ExerciseEditing, onSaved: () => void) {
  const [scopeRequest, setScopeRequest] = useState<ScopeRequest | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const commit = async (scope: EditScope) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await editing.save(saved, edited, scope);
      setScopeRequest(null);
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this exercise.');
    } finally {
      setIsSaving(false);
    }
  };

  // Only the fields that can reach other occurrences warrant asking where they should go.
  const requestSave = () => {
    const change = diffExercise(saved, edited);
    const counts = editing.count(saved);
    if (!change || counts.program === 0) {
      void commit('occurrence');
      return;
    }
    setSaveError(null);
    setScopeRequest({ changes: describeChange(change), counts });
  };

  return { isSaving, saveError, setSaveError, scopeRequest, setScopeRequest, requestSave, commit };
}
