import { useEffect, useMemo, useState, type FormEvent, type HTMLAttributes } from 'react';
import { ArrowRight, Library, RotateCcw, Trash2 } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft, ProgramSummary } from '../types';
import { ApiError, api } from '../lib/api';
import { changedDayIds, isProgramFinished, programToDraft } from '../lib/activeSlot';
import { ProgramDayWrites } from '../lib/programDayWrites';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import { Modal } from './ui/Modal';
import { MenuItem } from './ui/MenuButton';
import { ProgramWeekChecklist } from './ProgramWeekChecklist';
import { ProgramWeekMeter } from './ProgramWeekMeter';
import { SlotCardHeader } from './SlotCardHeader';

export type SlotCardActions = {
  busy: boolean;
  onMoveToLibrary: () => void;
  onRestart: () => void;
  onDelete: () => void;
};

/// The program in the active slot. While a run is underway it shows the week checklist, which
/// folds away behind the header (and while the card is dragged); once every week is passed it
/// turns into a finished card offering a restart or a move back to the library.
export function ActiveProgramCard({ program, exercises, onStart, onChanged, hasActiveWorkout, activeTemplateId = null, actions, dragProps, moving, dragging }: {
  program: ProgramSummary;
  exercises: Exercise[];
  onStart: (id: string) => void;
  onChanged: () => Promise<void>;
  hasActiveWorkout: boolean;
  /** The day the open workout came from; that day continues it instead of refusing a start. */
  activeTemplateId?: string | null;
  actions: SlotCardActions;
  dragProps: HTMLAttributes<HTMLElement>;
  moving: boolean;
  dragging: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const writes = useMemo(() => new ProgramDayWrites(api.updateTemplate, () => {}), [program.id]);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const finished = isProgramFinished(program);
  const next = program.days.find(day => day.id === program.nextTemplateId);
  const firstWeek = program.days.length > 0 ? Math.min(...program.days.map(d => d.week)) : 1;
  const progress = program.progress ?? (program.days.length > 0 ? {
    runId: 'optimistic',
    currentWeek: firstWeek,
    currentAttempt: 1,
    passedDays: 0,
    totalDays: program.days.length,
    days: program.days.filter(d => d.week === firstWeek).map((d, idx) => ({
      templateId: d.id,
      status: 'pending' as const,
      isRestDay: d.isRestDay,
      position: idx
    }))
  } : null);
  const weekCount = new Set(program.days.map(day => day.week)).size;
  const weekIndex = progress ? [...new Set(program.days.map(day => day.week))].sort((a, b) => a - b).indexOf(progress.currentWeek) + 1 : 1;
  const canReset = Boolean(program.active && (progress?.passedDays ?? 0) > 0);

  async function loadDetail() {
    setLoading(true); setError('');
    try {
      const full = await api.getProgram(program.id);
      writes.setTemplates(full.workouts);
      const loaded = programToDraft(full);
      setDraft({ ...loaded, workouts: loaded.workouts.map(day => writes.pending.get(day.lineId) ?? day) });
    }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not load this program.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!finished && program.id) {
      void loadDetail();
    }
  }, [program.id, program.revision, finished]);

  // A tall card is hard to carry across the page, so lifting it folds it down to its header.
  // When released on the active workout, it always expands automatically.
  useEffect(() => {
    if (dragging) {
      setExpanded(false);
    } else {
      setExpanded(true);
    }
  }, [dragging]);

  // Every program upon being placed onto the active workout is expanded automatically.
  useEffect(() => {
    setExpanded(true);
  }, [program.id]);

  function resetActionInput() {
    if (!progress) throw new Error('The current program week is not available. Refresh and try again.');
    return {
      revision: program.revision,
      runId: progress.runId,
      week: progress.currentWeek,
      attempt: progress.currentAttempt,
      idempotencyId: crypto.randomUUID()
    };
  }

  async function handleResetWeek(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!progress || !canReset || resetPhrase !== 'RESET' || hasActiveWorkout || saving || writes.pending.size > 0) return;
    setResetBusy(true);
    setResetError('');
    try {
      await api.resetProgramWeek(program.id, { ...resetActionInput(), confirmation: resetPhrase });
      await onChanged();
      setResetOpen(false);
      setResetPhrase('');
    } catch (failure) {
      setResetError(failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : 'Could not reset this week.');
    } finally { setResetBusy(false); }
  }

  async function savePending() {
    setSaving(true);
    setError('');
    try {
      await writes.flush();
      const full = await api.getProgram(program.id);
      writes.setTemplates(full.workouts);
      setDraft(programToDraft(full));
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save this program. Your edits are kept for retry.');
      throw failure;
    } finally { setSaving(false); }
  }

  async function handleDayChange(updatedDay: DraftWorkout) {
    setDraft(prev => prev ? {
      ...prev,
      workouts: prev.workouts.map(w => w.lineId === updatedDay.lineId ? updatedDay : w)
    } : null);
    writes.enqueue([updatedDay]);
    await savePending();
  }

  /// An edit can reach a block or the whole program; only the days it changed are saved.
  async function handleDraftChange(updatedDraft: ImportDraft) {
    const changed = new Set(draft ? changedDayIds(draft, updatedDraft) : updatedDraft.workouts.map(day => day.lineId));
    writes.enqueue(updatedDraft.workouts.filter(day => changed.has(day.lineId)));
    await savePending();
  }

  const meta = finished
    ? `${weekCount} ${weekCount === 1 ? 'week' : 'weeks'} completed`
    : <ProgramWeekMeter week={weekIndex} weeks={weekCount} passedDays={progress?.passedDays ?? 0} totalDays={progress?.totalDays ?? 0} />;
  const actionsBlocked = actions.busy || saving || writes.pending.size > 0;

  return <section {...dragProps} className={`panel slot-card program-card ${finished ? 'slot-card-finished' : ''} ${moving ? 'slot-card-moving' : ''}`}
    aria-busy={actions.busy || loading || saving}>
    <SlotCardHeader title={program.name} meta={meta}
      badge={finished ? <span className="tiny-label slot-finished-label">Finished</span> : undefined}
      expanded={finished ? undefined : expanded} onToggle={finished ? undefined : () => setExpanded(value => !value)}
      menuLabel={`Actions for ${program.name}`}
      menu={<>
        <MenuItem disabled={actionsBlocked} onClick={actions.onMoveToLibrary}><Library size={14} />Move to library</MenuItem>
        <MenuItem disabled={actionsBlocked} onClick={actions.onRestart}><RotateCcw size={14} />Restart from the beginning</MenuItem>
        {canReset && <MenuItem disabled={actionsBlocked || hasActiveWorkout} onClick={() => { setResetOpen(true); setResetPhrase(''); setResetError(''); }}><RotateCcw size={14} />Reset this week</MenuItem>}
        <MenuItem destructive disabled={actionsBlocked} onClick={actions.onDelete}><Trash2 size={14} />Delete program</MenuItem>
      </>} />

    {finished
      ? <SlotFinished name={program.name} description="You passed every week of this program." actions={{ ...actions, busy: actionsBlocked }} />
      : expanded && <>
        {progress && <ProgramWeekChecklist program={{ ...program, progress }} actionsBusy={actionsBlocked || progress.runId === 'optimistic'} draft={draft} exercises={exercises} onStart={onStart} onChanged={onChanged} hasActiveWorkout={hasActiveWorkout} activeTemplateId={activeTemplateId} onDayChange={handleDayChange} onDraftChange={handleDraftChange} />}
        {!progress && next && <div className="slot-card-actions">
          <Button variant="primary" disabled={hasActiveWorkout && next.id !== activeTemplateId} onClick={() => onStart(next.id)}>
            {next.id === activeTemplateId ? 'Continue' : 'Start'} {next.name}<ArrowRight size={16} />
          </Button>
        </div>}
      </>}
    {error && <CardFeedback message={error} action={{
      label: writes.pending.size > 0 ? 'Retry save' : 'Retry refresh', disabled: saving,
      onClick: () => { void savePending().catch(() => {}); }
    }} />}

    {resetOpen && <Modal title="Reset this week?" onClose={() => { setResetOpen(false); setResetPhrase(''); }}>
      <form className="modal-body program-week-reset-form" noValidate onSubmit={event => void handleResetWeek(event)}>
        <p>This clears the checkmarks for Week {progress?.currentWeek}. Completed workout history stays saved.</p>
        <label className="field" htmlFor={`reset-program-week-${program.id}`}>
          Type <strong>RESET</strong> to confirm
          <input id={`reset-program-week-${program.id}`} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={resetPhrase}
            // Phone keyboards capitalise only the first letter and may add a space after a suggestion.
            onChange={event => setResetPhrase(event.target.value.trim().toUpperCase())} aria-describedby={`reset-program-week-hint-${program.id}`} />
        </label>
        <small id={`reset-program-week-hint-${program.id}`}>This cannot be undone. The current week will start again at day one.</small>
        {hasActiveWorkout && <p className="error-text" role="alert">Finish or discard the active workout first.</p>}
        {resetError && <p className="error-text" role="alert">{resetError}</p>}
        <div className="modal-actions">
          <Button type="button" disabled={resetBusy} onClick={() => { setResetOpen(false); setResetPhrase(''); }}>Cancel</Button>
          <Button type="submit" variant="destructive" disabled={resetPhrase !== 'RESET' || resetBusy || hasActiveWorkout}>
            <RotateCcw size={15} />{resetBusy ? 'Resetting…' : 'Reset week'}
          </Button>
        </div>
      </form>
    </Modal>}
  </section>;
}

/// The finished state shared by programs and standalone workouts in the active slot.
export function SlotFinished({ name, description, actions }: { name: string; description?: string; actions: SlotCardActions }) {
  const trimmed = description?.replace(/^Workout completed\.?\s*/i, '').trim();
  const text = trimmed
    ? (trimmed.toLowerCase().includes('restart') ? trimmed : `${trimmed} Restart or move to library.`)
    : 'Restart or move to library.';
  return <div className="slot-finished" role="status" aria-label={`${name} completed`}>
    <div className="slot-finished-copy">
      <strong>Completed</strong>
      <p>{text}</p>
    </div>
    <div className="slot-card-actions">
      <Button variant="secondary" disabled={actions.busy} onClick={actions.onMoveToLibrary}><Library size={15} />Move to library</Button>
      <Button variant="primary" disabled={actions.busy} onClick={actions.onRestart}><RotateCcw size={15} />Restart</Button>
    </div>
  </div>;
}
