import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftWorkout, ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { validateDraftWorkout, validateName } from '../lib/validation';
import { changedDraftDays } from '../lib/importDraftDiff';

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
  const dirtyRef = useRef(false);
  const failureRef = useRef('');
  const editVersion = useRef(0);

  useEffect(() => {
    if (selectedRef.current?.id !== selected?.id) {
      editVersion.current++; dirtyRef.current = false; failureRef.current = '';
      setLocalDirty(false); setSaveError(''); draftRef.current = selected?.draft ?? null;
    }
    selectedRef.current = selected;
  }, [selected, setSaveError]);
  useEffect(() => { if (draft !== null) draftRef.current = draft; }, [draft]);

  const applyView = useCallback((view: ImportView) => {
    selectedRef.current = view;
    draftRef.current = view.draft;
    setSelected(view);
    setDraft(view.draft);
    setLocalDirty(false);
    dirtyRef.current = false;
    failureRef.current = '';
    setSaveError('');
  }, [setDraft, setSelected, setSaveError]);

  const enqueue = useCallback((next: ImportDraft, request: (view: ImportView, revision: number) => Promise<ImportView>, failureMessage: string, full = false) => {
    const version = ++editVersion.current;
    const importId = selectedRef.current?.id;
    draftRef.current = next;
    setDraft(next);
    setLocalDirty(true);
    dirtyRef.current = true;
    pendingRef.current += 1;
    setPending(pendingRef.current);

    const run = async () => {
      try {
        if (failureRef.current && !full) throw new Error(failureRef.current);
        const view = selectedRef.current;
        if (!view || view.id !== importId) return;
        const saved = await request(view, view.revision);
        if (selectedRef.current?.id !== importId) return;
        if (full) failureRef.current = '';
        selectedRef.current = saved;
        // Keep the newest optimistic draft visible while later writes are waiting. The response
        // still advances the server revision used by the next queued request.
        if (editVersion.current === version) {
          draftRef.current = saved.draft;
          setDraft(saved.draft);
          setSelected(saved);
          setLocalDirty(false);
          dirtyRef.current = false;
          setSaveError('');
        } else {
          setSelected({ ...saved, draft: draftRef.current });
        }
        // The app-wide refresh only updates the import list beside this screen; the saved view is
        // already applied, so the next queued save and the editor never wait on it.
        void onChanged();
      } catch (failure) {
        if (selectedRef.current?.id !== importId) return;
        failureRef.current = failure instanceof Error ? failure.message : failureMessage;
        setSaveError(failureRef.current);
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
      dirtyRef.current = true;
      failureRef.current = invalid;
      return Promise.resolve();
    }
    setSaveError('');
    return enqueue(next, (view, revision) => api.editImport(view.id, next, revision), 'Could not save your changes.', true);
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
    dirtyRef.current = true;
    if (invalid) {
      setSaveError(invalid);
      failureRef.current = invalid;
      return Promise.resolve();
    }
    setSaveError('');
    return enqueue(next, (view, revision) => api.editImportDay(view.id, day, revision), 'Could not save this day.');
  }, [enqueue, setDraft, setSaveError]);

  const flush = useCallback(async (requireClean = true) => {
    await queueRef.current;
    if (requireClean && (dirtyRef.current || failureRef.current))
      throw new Error(failureRef.current || 'Save your draft changes before creating the program.');
  }, []);

  const mutate = useCallback((request: (view: ImportView, revision: number) => Promise<ImportView>, failureMessage: string) => {
    setSaveError('');
    pendingRef.current += 1;
    setPending(pendingRef.current);
    const run = async () => {
      try {
        if (failureRef.current || dirtyRef.current) throw new Error(failureRef.current || 'Save the draft changes first.');
        const view = selectedRef.current;
        if (!view) return;
        const saved = await request(view, view.revision);
        applyView(saved);
        void onChanged();
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
  const editLocal = useCallback((next: ImportDraft) => {
    editVersion.current++; draftRef.current = next; dirtyRef.current = true; setLocalDirty(true); setDraft(next);
  }, [setDraft]);
  const retry = useCallback(async () => {
    if (draftRef.current) await persist(draftRef.current);
    await flush();
  }, [persist, flush]);

  // Explicit exercise saves must reject failures so the editor retains its held edits for retry.
  // An edit applied to every occurrence touches a handful of days in a program that can run to
  // hundreds, so only those days are sent; a whole-draft save would upload the entire program.
  const persistExercise = useCallback((next: ImportDraft) => {
    const current = draftRef.current;
    const days = current ? changedDraftDays(current, next) : null;
    if (days?.length === 0) return Promise.resolve();
    return mutate((view, revision) => days
      ? api.editImportDays(view.id, days, revision)
      : api.editImport(view.id, next, revision), 'Could not save this exercise.');
  }, [mutate]);

  return { persist, persistDay, persistExercise, flush, mutate, revision, applyView, editLocal, retry, pending: pending > 0, localDirty };
}
