import { useState, type HTMLAttributes } from 'react';
import { ArrowRight, Library, PartyPopper, RotateCcw, Trash2 } from 'lucide-react';
import type { Exercise, ProgramSummary, Template, TemplateExercise } from '../types';
import { ApiError, api } from '../lib/api';
import { isProgramFinished } from '../lib/activeSlot';
import { Button } from './ui/Button';
import { MenuItem } from './ui/MenuButton';
import { ProgramWeekChecklist } from './ProgramWeekChecklist';
import { ProgramDayTree } from './ProgramDayTree';
import { ProgramSwapModal } from './ProgramSwapModal';
import { SlotCardHeader } from './SlotCardHeader';

export type SlotCardActions = {
  busy: boolean;
  onMoveToLibrary: () => void;
  onRestart: () => void;
  onDelete: () => void;
};

/// The program in the active slot. While a run is underway it keeps the week checklist, the next
/// workout, and exercise swaps; once every week is passed it turns into a finished card offering
/// a restart or a move back to the library.
export function ActiveProgramCard({ program, exercises, onStart, onChanged, hasActiveWorkout, actions, dragProps, moving }: {
  program: ProgramSummary;
  exercises: Exercise[];
  onStart: (id: string) => void;
  onChanged: () => Promise<void>;
  hasActiveWorkout: boolean;
  actions: SlotCardActions;
  dragProps: HTMLAttributes<HTMLElement>;
  moving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<Template[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [swapTarget, setSwapTarget] = useState<{ template: Template; exercise: TemplateExercise } | null>(null);
  const finished = isProgramFinished(program);
  const next = program.days.find(day => day.id === program.nextTemplateId);
  const progress = program.progress;
  const currentDays = progress ? program.days.filter(day => day.week === progress.currentWeek) : program.days;
  const weekCount = new Set(program.days.map(day => day.week)).size;
  const weekIndex = progress ? [...new Set(program.days.map(day => day.week))].sort((a, b) => a - b).indexOf(progress.currentWeek) + 1 : 1;

  async function loadDetail() {
    setLoading(true); setError('');
    try { setDetail((await api.getProgram(program.id)).workouts); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not load this program.'); }
    finally { setLoading(false); }
  }

  function toggle() {
    if (!expanded && detail === null) void loadDetail();
    setExpanded(value => !value);
  }

  const meta = finished
    ? `${weekCount} ${weekCount === 1 ? 'week' : 'weeks'} completed`
    : `Week ${weekIndex} of ${weekCount}${progress ? ` · ${progress.passedDays} of ${progress.totalDays} days passed` : ''}`;

  return <section {...dragProps} className={`panel slot-card program-card ${finished ? 'slot-card-finished' : ''} ${moving ? 'slot-card-moving' : ''}`}
    aria-busy={actions.busy || loading}>
    <SlotCardHeader title={program.name} meta={meta}
      badge={<span className={`tiny-label ${finished ? 'slot-finished-label' : 'accent'}`}>{finished ? 'Finished' : 'Active'}</span>}
      expanded={finished ? undefined : expanded} onToggle={finished ? undefined : toggle}
      menuLabel={`Actions for ${program.name}`}
      menu={<>
        <MenuItem disabled={actions.busy} onClick={actions.onMoveToLibrary}><Library size={14} />Move to library</MenuItem>
        <MenuItem disabled={actions.busy} onClick={actions.onRestart}><RotateCcw size={14} />Restart from the beginning</MenuItem>
        <MenuItem destructive disabled={actions.busy} onClick={actions.onDelete}><Trash2 size={14} />Delete program</MenuItem>
      </>} />

    {finished
      ? <SlotFinished name={program.name} description="You passed every week of this program." actions={actions} />
      : <>
        {progress && <ProgramWeekChecklist program={program} onStart={onStart} onChanged={onChanged} hasActiveWorkout={hasActiveWorkout} />}
        {expanded && (detail
          ? <ProgramDayTree days={currentDays} completed={program.completedTemplateIds} skipped={program.skippedTemplateIds ?? []}
            nextId={program.nextTemplateId} detail={detail} exercises={exercises} onStart={onStart} canStart
            onSwap={template => exercise => setSwapTarget({ template, exercise })} />
          : loading && <p className="muted small-copy" role="status">Loading this week…</p>)}
        {next && <div className="slot-card-actions">
          <Button variant="primary" disabled={hasActiveWorkout} onClick={() => onStart(next.id)}>Start {next.name}<ArrowRight size={16} /></Button>
        </div>}
      </>}
    {error && <p className="error-text" role="alert">{error}</p>}

    {swapTarget && <ProgramSwapModal program={program} target={swapTarget} detail={detail} exercises={exercises}
      onClose={() => setSwapTarget(null)}
      onApplied={async () => { await onChanged(); await loadDetail(); setSwapTarget(null); }} />}
  </section>;
}

/// The finished state shared by programs and standalone workouts in the active slot.
export function SlotFinished({ name, description, actions }: { name: string; description: string; actions: SlotCardActions }) {
  return <div className="slot-finished" role="status">
    <span className="slot-finished-icon" aria-hidden="true"><PartyPopper size={20} /></span>
    <div className="slot-finished-copy">
      <strong>{name} is finished</strong>
      <p>{description} Restart it from the beginning, or move it back to the library.</p>
    </div>
    <div className="slot-card-actions">
      <Button variant="secondary" disabled={actions.busy} onClick={actions.onMoveToLibrary}><Library size={15} />Move to library</Button>
      <Button variant="primary" disabled={actions.busy} onClick={actions.onRestart}><RotateCcw size={15} />Restart</Button>
    </div>
  </div>;
}
