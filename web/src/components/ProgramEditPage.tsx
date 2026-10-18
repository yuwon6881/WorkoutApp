import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft, Program } from '../types';
import { ApiError, api } from '../lib/api';
import { programToDraft } from '../lib/activeSlot';
import { ensureStructureIds } from '../lib/importDraftWeeks';
import {
  checkProgramEdit, draftToProgramEdit, hasLocks, isEdited, programEditLocks, unmappedExerciseIn
} from '../lib/programEditLocks';
import { validateProgramEditorDocument } from '../lib/validation';
import { DraftOutline } from './ImportDraftTree';
import { Button } from './ui/Button';
import { BackButton } from './ui/BackButton';
import { CardFeedback } from './ui/CardFeedback';
import { Modal } from './ui/Modal';
import './ProgramTimeline.css';
import './ProgramStructureBar.css';
import './ProgramEditPage.css';

/// Edits a saved program, including the one in the active slot. The program is held here until
/// Save, like a new program in the builder. For an active program the weeks and days the run has
/// already passed are shown but cannot be changed, and every change is checked against them
/// before it is applied.
export function ProgramEditPage({ programId, exercises, activeTemplateId, onBack, onSaved }: {
  programId: string;
  exercises: Exercise[];
  /// The day the open workout started from; it cannot be removed or moved while the workout is open.
  activeTemplateId: string | null;
  onBack: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [program, setProgram] = useState<Program | null>(null);
  const [original, setOriginal] = useState<ImportDraft | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const requestId = useRef(crypto.randomUUID());

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const loaded = await api.getProgram(programId);
      const base = ensureStructureIds(programToDraft(loaded));
      setProgram(loaded);
      setOriginal(base);
      setDraft(base);
      setSaveError(null);
      setNotice('');
    } catch (failure) {
      setLoadError(failure instanceof ApiError ? failure.message : 'Could not load this program.');
    }
  }, [programId]);

  useEffect(() => { void load(); }, [load]);

  const locks = useMemo(() => program ? programEditLocks(program, activeTemplateId) : null, [program, activeTemplateId]);
  const knownDayIds = useMemo(() => new Set(program?.workouts.map(day => day.id) ?? []), [program]);
  const edited = !!original && !!draft && isEdited(original, draft);

  useEffect(() => {
    if (!edited) return undefined;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [edited]);

  /// Every change, from any control, passes through here: one that would alter a passed day or
  /// week is refused with the reason instead of being applied.
  const apply = useCallback(async (next: ImportDraft) => {
    if (!original || !locks) return;
    const reason = checkProgramEdit(original, next, locks);
    if (reason) {
      setNotice(reason);
      return;
    }
    setNotice('');
    setSaveError(null);
    requestId.current = crypto.randomUUID();
    setDraft(next);
  }, [locks, original]);

  const changeDay = useCallback(async (day: DraftWorkout) => {
    if (!draft) return;
    await apply({ ...draft, workouts: draft.workouts.map(item => item.lineId === day.lineId ? day : item) });
  }, [apply, draft]);

  const issue = useMemo(() => {
    if (!original || !draft) return undefined;
    return validateProgramEditorDocument(draft, false, false) ?? unmappedExerciseIn(original, draft) ?? undefined;
  }, [draft, original]);

  const save = useCallback(async () => {
    if (!program || !original || !draft || !locks) return;
    const invalid = issue ?? checkProgramEdit(original, draft, locks);
    if (invalid) {
      setNotice(invalid);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.updateProgramPlan(program.id, draftToProgramEdit(draft, program.revision, knownDayIds, requestId.current));
      await onSaved();
      onBack();
    } catch (failure) {
      setSaveError({
        message: failure instanceof Error ? failure.message : 'Could not save this program.',
        conflict: failure instanceof ApiError && failure.conflict
      });
    } finally {
      setSaving(false);
    }
  }, [draft, issue, knownDayIds, locks, onBack, onSaved, original, program]);

  const leave = () => (edited ? setLeaveOpen(true) : onBack());

  return <div className="program-builder-page ptl-builder-page">
    <div className="page-heading ptl-page-heading">
      <div>
        <BackButton to="workouts" onClick={leave} />
        <h1>Edit program</h1>
      </div>
    </div>

    {loadError && <CardFeedback message={loadError} action={{ label: 'Retry', onClick: () => void load() }} />}
    {!loadError && !draft && <p className="muted small-copy" role="status">Loading program…</p>}

    {draft && original && locks && <>
      {hasLocks(locks) && <p className="ptl-lock-note">
        <Lock size={14} aria-hidden="true" /> Weeks and days you have already passed are locked. Everything from Week {locks.currentWeek} on that you have not done yet can be changed.
      </p>}
      {notice && <div className="error-banner" role="alert"><span>{notice}</span></div>}
      {saveError && <CardFeedback message={saveError.message}
        action={saveError.conflict ? { label: 'Reload program', onClick: () => void load() } : undefined} />}
      <DraftOutline draft={draft} expandedDay={expandedDay} setExpandedDay={setExpandedDay}
        exercises={exercises} onDayChange={changeDay} onDraftChange={apply}
        editorMode="custom" actionLabel="Save changes" editableProgramName
        onProgramNameChange={programName => void apply({ ...draft, programName })}
        acceptable={edited && !issue} busy={saving} actionHint={issue ?? (edited ? undefined : 'Make a change to save it.')}
        onAcceptProgram={() => void save()} locks={locks} />
    </>}

    {leaveOpen && <Modal title="Leave without saving?" onClose={() => setLeaveOpen(false)}>
      <div className="modal-body">
        <p>Your changes to this program have not been saved. Leaving discards them.</p>
      </div>
      <div className="modal-actions">
        <Button variant="tertiary" onClick={() => setLeaveOpen(false)}>Keep editing</Button>
        <Button variant="destructive" onClick={onBack}>Leave and discard</Button>
      </div>
    </Modal>}
  </div>;
}
