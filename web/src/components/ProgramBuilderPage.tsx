import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, LoaderCircle, RotateCcw, Save } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft, ProgramDraftView, ProgramEditorDocument } from '../types';
import { validateProgramEditorDocument } from '../lib/validation';
import { ApiError } from '../lib/api';
import { useProgramDraftSaver } from './useProgramDraftSaver';
import { DraftOutline, type DraftOutlineHandle } from './ImportDraftTree';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

export function ProgramBuilderPage({ initialView, initialDraft, exercises, onBack, onDraftSaved, onCreated }: {
  initialView: ProgramDraftView | null;
  initialDraft?: ImportDraft;
  exercises: Exercise[];
  onBack: () => void;
  onDraftSaved: () => void | Promise<void>;
  onCreated: () => Promise<void> | void;
}) {
  const [selected, setSelected] = useState<ProgramDraftView | null>(initialView);
  const [draft, setDraft] = useState<ProgramEditorDocument>(initialView?.draft ?? initialDraft ?? { programName: '', workouts: [] });
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [validationError, setValidationError] = useState('');
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const outlineRef = useRef<DraftOutlineHandle>(null);
  const initializedNewDraft = useRef(false);
  const save = useProgramDraftSaver({ selected, setSelected, draft, setDraft, onSaved: onDraftSaved });
  const issue = validateProgramEditorDocument(draft, true);
  const busy = save.pending;

  useEffect(() => {
    if (selected || initializedNewDraft.current) return;
    initializedNewDraft.current = true;
    void save.persist(draft);
  }, [draft, save.persist, selected]);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (!save.localDirty && !save.pending) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [save.localDirty, save.pending]);

  const update = useCallback((next: ProgramEditorDocument) => {
    setDraft(next);
    setValidationError('');
    void save.persist(next);
  }, [save.persist]);

  const changeDay = useCallback(async (day: DraftWorkout) => {
    const next: ProgramEditorDocument = {
      ...draft,
      workouts: draft.workouts.map(item => item.lineId === day.lineId ? day : item)
    };
    update(next);
  }, [draft, update]);

  const create = useCallback(async () => {
    const invalid = validateProgramEditorDocument(draft, true);
    if (invalid) {
      setValidationError(invalid);
      const unmappedDay = draft.workouts.find(day => !day.isRestDay && day.exercises.some(exercise => !exercise.exerciseId));
      const unmappedExercise = unmappedDay?.exercises.find(exercise => !exercise.exerciseId);
      if (unmappedDay && unmappedExercise) {
        setExpandedDay(unmappedDay.lineId);
        outlineRef.current?.focusIssue({ workoutLineId: unmappedDay.lineId, exerciseLineId: unmappedExercise.lineId, targetField: 'library' });
      } else if (!draft.programName.trim()) {
        document.querySelector<HTMLInputElement>('[name="program-name"]')?.focus();
      } else {
        const first = draft.workouts.find(day => !day.isRestDay) ?? draft.workouts[0];
        if (first) {
          setExpandedDay(first.lineId);
          outlineRef.current?.focusIssue({ workoutLineId: first.lineId, targetField: 'name' });
        }
      }
      return;
    }
    setValidationError('');
    try {
      await save.flush();
      await save.createProgram();
      await onCreated();
      onBack();
    } catch (failure) {
      if (!(failure instanceof ApiError && failure.conflict)) {
        setValidationError(failure instanceof ApiError ? failure.message : 'Could not create this program.');
      }
    }
  }, [draft, onBack, onCreated, save]);

  const leave = useCallback(async () => {
    try {
      await save.flush();
      onBack();
    } catch {
      setLeaveConfirmOpen(true);
    }
  }, [onBack, save]);

  const setProgramName = useCallback((programName: string) => update({ ...draft, programName }), [draft, update]);
  const allSaved = !busy && !save.localDirty && !save.error && !save.conflicted;

  return <div className="program-builder-page">
    <div className="page-heading">
      <div>
        <Button variant="tertiary" onClick={() => void leave()}><ArrowLeft size={16} />Back to workouts</Button>
        <h1>Build a program</h1>
      </div>
      <div className="program-builder-save-state" role="status" aria-live="polite">
        {busy && <><LoaderCircle className="spin" size={15} />Saving…</>}
        {allSaved && <><Save size={15} />Saved</>}
        {!busy && save.localDirty && !save.error && <span>Saving changes…</span>}
      </div>
    </div>

    {(save.error || validationError) && <div className="error-banner" role="alert">
      <span>{validationError || save.error}</span>
      {save.conflicted
        ? <div className="settings-actions">
          <Button variant="secondary" onClick={() => void save.reloadServer()}><RotateCcw size={15} />Load server version</Button>
          <Button variant="tertiary" onClick={() => void save.saveAsCopy()}>Save my edits as another draft</Button>
        </div>
        : save.error && <Button variant="tertiary" onClick={() => void save.retry()}><RotateCcw size={15} />Retry save</Button>}
    </div>}

    <DraftOutline ref={outlineRef} draft={draft} expandedDay={expandedDay} setExpandedDay={setExpandedDay}
      exercises={exercises} onDayChange={changeDay} onDraftChange={async next => update(next)}
      editorMode="custom" actionLabel="Create program" editableProgramName onProgramNameChange={setProgramName}
      acceptable={!save.conflicted} busy={busy || !allSaved} actionHint={save.conflicted ? 'Resolve the draft conflict before creating the program.' : undefined}
      onAcceptProgram={() => void create()} />
    {issue && !validationError && (draft.programName.trim() !== '' || issue !== 'Program name is required.') && (
      <p className="program-builder-hint" role="status">{issue}</p>
    )}
    {leaveConfirmOpen && <Modal title="Leave this program draft?" onClose={() => setLeaveConfirmOpen(false)}>
      <div className="modal-body">
        <p>{save.hasSavedDraft
          ? 'The latest edits are not confirmed saved. Leaving keeps the last server-saved version in your drafts; local edits will be lost.'
          : 'The new draft has not been confirmed saved. If the server received the last request it remains in your drafts; otherwise these edits will be lost.'}</p>
      </div>
      <div className="modal-actions">
        <Button variant="tertiary" onClick={() => setLeaveConfirmOpen(false)}>Keep editing</Button>
        <Button variant="destructive" onClick={onBack}>Leave without saving</Button>
      </div>
    </Modal>}
  </div>;
}
