import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftWorkout, ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { validateDraftWorkout, validateName } from '../lib/validation';

type Options = {
  selected: ImportView | null;
  setSelected: (view: ImportView | null) => void;
  draft: ImportDraft | null;
  setDraft: (draft: ImportDraft | null | ((current: ImportDraft | null) => ImportDraft | null)) => void;
  onChanged: () => Promise<void>;
  setSaveError: (message: string) => void;
};

/// Import review has two editors which can both write the same JSON document. Every write is
/// serialized here and carries the revision returned by the previous write, so a slower response
/// can never replace a newer local substitution or week reorder.
export function useImportDraftSaver({ selected, setSelected, draft, setDraft, onChanged, setSaveError }: Options) {
  const selectedRef = useRef(selected);
  const draftRef = useRef(draft);
  const queueRef = useRef(Promise.resolve());
  const pendingRef = useRef(0);
  const [pending, setPending] = useState(0);
  const [localDirty, setLocalDirty] = useState(false);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { if (draft !== null) draftRef.current = draft; }, [draft]);

  const applyView = useCallback((view: ImportView) => {
    selectedRef.current = view;
    draftRef.current = view.draft;
    setSelected(view);
    setDraft(view.draft);
    setLocalDirty(false);
  }, [setDraft, setSelected]);

  const enqueue = useCallback((next: ImportDraft, request: (view: ImportView, revision: number) => Promise<ImportView>, failureMessage: string) => {
    draftRef.current = next;
    setDraft(next);
    setLocalDirty(true);
    pendingRef.current += 1;
    setPending(pendingRef.current);

    const run = async () => {
      try {
        const view = selectedRef.current;
        if (!view) return;
        const saved = await request(view, view.revision);
        selectedRef.current = saved;
        // Keep the newest optimistic draft visible while later writes are waiting. The response
        // still advances the server revision used by the next queued request.
        if (pendingRef.current === 1) {
          draftRef.current = saved.draft;
          setDraft(saved.draft);
          setSelected(saved);
          setLocalDirty(false);
        } else {
          setSelected({ ...saved, draft: draftRef.current });
        }
        await onChanged();
      } catch (failure) {
        setSaveError(failure instanceof ApiError ? failure.message : failureMessage);
      } finally {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        setPending(pendingRef.current);
      }
    };

    const result = queueRef.current.then(run, run);
    queueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, [onChanged, setDraft, setSaveError, setSelected]);

  const persist = useCallback((next: ImportDraft) => {
    const invalid = validateName(next.programName, 'Program name');
    if (invalid) {
      setDraft(next);
      draftRef.current = next;
      setSaveError(invalid);
      setLocalDirty(true);
      return Promise.resolve();
    }
    setSaveError('');
    return enqueue(next, (view, revision) => api.editImport(view.id, next, revision), 'Could not save your changes.');
  }, [enqueue, setDraft, setSaveError]);

  const persistDay = useCallback((day: DraftWorkout) => {
    const invalid = validateDraftWorkout(day);
    const current = draftRef.current;
    const next = current
      ? { ...current, workouts: current.workouts.map(item => item.lineId === day.lineId ? day : item) }
      : null;
    if (!next) return Promise.resolve();
    setDraft(next);
    draftRef.current = next;
    setLocalDirty(true);
    if (invalid) {
      setSaveError(invalid);
      return Promise.resolve();
    }
    setSaveError('');
    return enqueue(next, (view, revision) => api.editImportDay(view.id, day, revision), 'Could not save this day.');
  }, [enqueue, setDraft, setSaveError]);

  const flush = useCallback(async () => {
    await queueRef.current;
  }, []);

  const mutate = useCallback((request: (view: ImportView, revision: number) => Promise<ImportView>, failureMessage: string) => {
    setSaveError('');
    pendingRef.current += 1;
    setPending(pendingRef.current);
    const run = async () => {
      try {
        const view = selectedRef.current;
        if (!view) return;
        const saved = await request(view, view.revision);
        applyView(saved);
        await onChanged();
      } catch (failure) {
        setSaveError(failure instanceof ApiError ? failure.message : failureMessage);
        throw failure;
      } finally {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        setPending(pendingRef.current);
      }
    };
    const result = queueRef.current.then(run, run);
    queueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, [applyView, onChanged, setSaveError]);

  const revision = useCallback(() => selectedRef.current?.revision, []);

  return { persist, persistDay, flush, mutate, revision, applyView, pending: pending > 0, localDirty };
}
