import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Program, ProgramDraftView, ProgramEditorDocument } from '../types';
import { ApiError, api } from '../lib/api';

type Options = {
  selected: ProgramDraftView | null;
  setSelected: Dispatch<SetStateAction<ProgramDraftView | null>>;
  draft: ProgramEditorDocument;
  setDraft: Dispatch<SetStateAction<ProgramEditorDocument>>;
  onSaved?: () => void | Promise<void>;
};

/// Program edits share one revision. Serial writes carry each acknowledged revision forward,
/// while the newest optimistic document stays visible as older requests finish.
export function useProgramDraftSaver({ selected, setSelected, draft, setDraft, onSaved }: Options) {
  const selectedRef = useRef(selected);
  const draftRef = useRef(draft);
  const onSavedRef = useRef(onSaved);
  const queueRef = useRef(Promise.resolve());
  const createRequestRef = useRef<{ key: string; draft: ProgramEditorDocument } | null>(null);
  const pendingRef = useRef(0);
  const blockedRef = useRef(false);
  const conflictRef = useRef(false);
  const dirtyRef = useRef(false);
  const [pending, setPending] = useState(0);
  const [localDirty, setLocalDirty] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  const applyView = useCallback((view: ProgramDraftView) => {
    selectedRef.current = view;
    draftRef.current = view.draft;
    blockedRef.current = false;
    conflictRef.current = false;
    dirtyRef.current = false;
    setSelected(view);
    setDraft(view.draft);
    setLocalDirty(false);
    setConflicted(false);
    setError('');
  }, [setDraft, setSelected]);

  const persist = useCallback((next: ProgramEditorDocument) => {
    draftRef.current = next;
    dirtyRef.current = true;
    setDraft(next);
    setLocalDirty(true);

    if (blockedRef.current) return queueRef.current;

    pendingRef.current += 1;
    setPending(pendingRef.current);
    setError('');

    const run = async () => {
      try {
        if (blockedRef.current) return;
        const current = selectedRef.current;
        let saved: ProgramDraftView;
        if (current) {
          saved = await api.updateProgramDraft(current.id, draftRef.current, current.revision);
        } else {
          const createRequest = createRequestRef.current ?? {
            key: crypto.randomUUID(),
            draft: draftRef.current
          };
          createRequestRef.current = createRequest;
          saved = await api.createProgramDraft(createRequest.draft, createRequest.key);
          if (JSON.stringify(draftRef.current) !== JSON.stringify(saved.draft)) {
            saved = await api.updateProgramDraft(saved.id, draftRef.current, saved.revision);
          }
          createRequestRef.current = null;
        }
        selectedRef.current = saved;
        const laterWritesPending = pendingRef.current > 1;
        if (!laterWritesPending) {
          draftRef.current = saved.draft;
          dirtyRef.current = false;
          setDraft(saved.draft);
          setSelected(saved);
          setLocalDirty(false);
        } else {
          setSelected({ ...saved, draft: draftRef.current });
        }
        await onSavedRef.current?.();
      } catch (failure) {
        const message = failure instanceof ApiError ? failure.message : 'Could not save this program draft.';
        blockedRef.current = true;
        conflictRef.current = failure instanceof ApiError && failure.conflict && selectedRef.current !== null;
        setConflicted(conflictRef.current);
        setError(conflictRef.current
          ? 'This draft changed in another tab. Reload the server version or save your edits as a separate draft.'
          : message);
      } finally {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        setPending(pendingRef.current);
      }
    };

    const result = queueRef.current.then(run, run);
    queueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, [setDraft, setSelected]);

  const flush = useCallback(async () => {
    await queueRef.current;
    if (conflictRef.current) throw new ApiError('Resolve the draft conflict before creating the program.', 409);
    if (blockedRef.current) throw new ApiError(error || 'Resolve the save error before creating the program.', 0);
    if (dirtyRef.current) throw new ApiError('Wait for the latest draft changes to save before creating the program.', 0);
  }, [error]);

  const reloadServer = useCallback(async () => {
    await queueRef.current;
    const current = selectedRef.current;
    if (!current) return null;
    try {
      const response = await api.getProgramDraft(current.id);
      if (!response.draft || response.createdProgramId) {
        throw new ApiError('This draft has already created a program. Return to the workout list to continue.', 409);
      }
      const latest: ProgramDraftView = { ...response, draft: response.draft };
      applyView(latest);
      return latest;
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not reload the server draft.');
      throw failure;
    }
  }, [applyView]);

  const saveAsCopy = useCallback(async () => {
    await queueRef.current;
    const copy = await api.createProgramDraft(draftRef.current, crypto.randomUUID());
    applyView(copy);
    await onSavedRef.current?.();
    return copy;
  }, [applyView]);

  const retry = useCallback(() => {
    if (conflictRef.current) return Promise.resolve();
    blockedRef.current = false;
    setError('');
    return persist(draftRef.current);
  }, [persist]);

  const createProgram = useCallback(async (): Promise<Program> => {
    await flush();
    const current = selectedRef.current;
    if (!current) throw new ApiError('Save this draft before creating the program.', 0);
    try {
      const program = await api.createProgramFromDraft(current.id, current.revision);
      const converted = { ...current, createdProgramId: program.id };
      selectedRef.current = converted;
      setSelected(converted);
      await onSavedRef.current?.();
      return program;
    } catch (failure) {
      if (failure instanceof ApiError && failure.conflict) {
        conflictRef.current = true;
        blockedRef.current = true;
        setConflicted(true);
        setError('This draft changed in another tab. Reload the server version or save your edits as a separate draft.');
      }
      throw failure;
    }
  }, [flush, setSelected]);

  const revision = useCallback(() => selectedRef.current?.revision, []);
  const createdProgramId = selected?.createdProgramId ?? null;

  return {
    persist,
    flush,
    applyView,
    reloadServer,
    saveAsCopy,
    retry,
    createProgram,
    revision,
    pending: pending > 0,
    localDirty,
    conflicted,
    error,
    createdProgramId,
    hasSavedDraft: selected !== null
  };
}
