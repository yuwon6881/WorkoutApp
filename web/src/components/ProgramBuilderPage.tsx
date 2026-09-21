import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft, ProgramEditorDocument } from '../types';
import { validateProgramEditorDocument } from '../lib/validation';
import { ApiError, api } from '../lib/api';
import { DraftOutline, type DraftOutlineHandle } from './ImportDraftTree';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

/// The whole program is built in the browser and reaches the server once, when the lifter asks for
/// the program. Nothing half-built is stored, so leaving is a confirmed decision.
export function ProgramBuilderPage({ initialDraft, exercises, onBack, onCreated }: {
  initialDraft: ImportDraft;
  exercises: Exercise[];
  onBack: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<ProgramEditorDocument>(initialDraft);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [validationError, setValidationError] = useState('');
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const outlineRef = useRef<DraftOutlineHandle>(null);
  const requestId = useRef(crypto.randomUUID());
  const issue = validateProgramEditorDocument(draft, true);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, []);

  const update = useCallback((next: ProgramEditorDocument) => {
    setDraft(next);
    setValidationError('');
  }, []);

  const changeDay = useCallback(async (day: DraftWorkout) => {
    update({ ...draft, workouts: draft.workouts.map(item => item.lineId === day.lineId ? day : item) });
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
    setCreating(true);
    try {
      await api.createProgramFromEditor(draft, requestId.current);
      await onCreated();
      onBack();
    } catch (failure) {
      setValidationError(failure instanceof ApiError ? failure.message : 'Could not create this program.');
    } finally {
      setCreating(false);
    }
  }, [draft, onBack, onCreated]);

  const setProgramName = useCallback((programName: string) => update({ ...draft, programName }), [draft, update]);

  return <div className="program-builder-page">
    <div className="page-heading">
      <div>
        <Button variant="tertiary" onClick={() => setLeaveConfirmOpen(true)}><ArrowLeft size={16} />Back to workouts</Button>
        <h1>Build a program</h1>
      </div>
    </div>

    {validationError && <div className="error-banner" role="alert"><span>{validationError}</span></div>}

    <DraftOutline ref={outlineRef} draft={draft} expandedDay={expandedDay} setExpandedDay={setExpandedDay}
      exercises={exercises} onDayChange={changeDay} onDraftChange={async next => update(next)}
      editorMode="custom" actionLabel="Create program" editableProgramName onProgramNameChange={setProgramName}
      acceptable busy={creating}
      onAcceptProgram={() => void create()} />
    {issue && !validationError && (draft.programName.trim() !== '' || issue !== 'Program name is required.') && (
      <p className="program-builder-hint" role="status">{issue}</p>
    )}
    {leaveConfirmOpen && <Modal title="Leave this program?" onClose={() => setLeaveConfirmOpen(false)}>
      <div className="modal-body">
        <p>This program has not been created yet. Leaving discards everything built here.</p>
      </div>
      <div className="modal-actions">
        <Button variant="tertiary" onClick={() => setLeaveConfirmOpen(false)}>Keep editing</Button>
        <Button variant="destructive" onClick={onBack}>Leave and discard</Button>
      </div>
    </Modal>}
  </div>;
}
