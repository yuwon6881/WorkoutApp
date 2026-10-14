import type { HTMLAttributes } from 'react';
import { Check, Library, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { Template } from '../types';
import { isTemplateFinished } from '../lib/activeSlot';
import { showSetCount } from '../lib/training';
import { Button } from './ui/Button';
import { MenuItem } from './ui/MenuButton';
import { SlotCardHeader } from './SlotCardHeader';
import { SlotFinished, type SlotCardActions } from './ActiveProgramCard';

/// A standalone workout in the active slot behaves like a one-day program: a single day whose
/// tick fills in by itself once a session from it is finished.
export function ActiveTemplateCard({ template, onStart, onEdit, hasActiveWorkout, activeTemplateId = null, actions, dragProps, moving }: {
  template: Template;
  onStart: () => void;
  onEdit: () => void;
  hasActiveWorkout: boolean;
  /** The plan the open workout came from; its own card continues that workout. */
  activeTemplateId?: string | null;
  actions: SlotCardActions;
  dragProps: HTMLAttributes<HTMLElement>;
  moving: boolean;
}) {
  const finished = isTemplateFinished(template);
  const inProgress = activeTemplateId === template.id;
  // Only one workout can be open at a time; another one's card says so rather than just greying out.
  const startBlocked = hasActiveWorkout && !inProgress && !finished;
  const setCount = template.exercises.reduce((total, exercise) => total + exercise.sets.filter(set => !set.warmup).length, 0);
  const meta = `${template.exercises.length} ${template.exercises.length === 1 ? 'exercise' : 'exercises'} · ${showSetCount(setCount)}`;

  return <section {...dragProps} className={`panel slot-card template-slot-card ${finished ? 'slot-card-finished' : ''} ${moving ? 'slot-card-moving' : ''}`}
    aria-busy={actions.busy}>
    <SlotCardHeader title={template.name} meta={meta}
      badge={finished ? <span className="tiny-label slot-finished-label">Finished</span>
        : inProgress ? <span className="tiny-label slot-progress-label">In progress</span> : undefined}
      menuLabel={`Actions for ${template.name}`}
      menu={<>
        <MenuItem disabled={actions.busy} onClick={actions.onMoveToLibrary}><Library size={14} />Move to library</MenuItem>
        <MenuItem disabled={actions.busy || !finished} onClick={actions.onRestart}><RotateCcw size={14} />Restart</MenuItem>
        <MenuItem disabled={actions.busy} onClick={onEdit}><Pencil size={14} />Edit workout</MenuItem>
        <MenuItem destructive disabled={actions.busy} onClick={actions.onDelete}><Trash2 size={14} />Delete workout</MenuItem>
      </>} />

    <div className={['template-slot-day', finished && 'completed-slot', inProgress && !finished && 'in-progress'].filter(Boolean).join(' ')}>
      <span className={`template-slot-tick ${finished ? 'ticked' : ''}`} role="img"
        aria-label={finished ? 'Completed' : 'Not completed yet'}>{finished && <Check size={14} />}</span>
      {/* The card header already names the workout, so this row lists what is in it. */}
      <div className="template-slot-day-copy">
        <span className="template-slot-exercises">{template.exercises.slice(0, 4).map(exercise => exercise.name).join(', ')}{template.exercises.length > 4 ? `, and ${template.exercises.length - 4} more` : ''}</span>
        {startBlocked && <span className="template-slot-hint">Finish your open workout first.</span>}
      </div>
      {!finished && <Button variant="primary" className="slot-start-btn" disabled={startBlocked}
        aria-label={`${inProgress ? 'Continue' : 'Start'} ${template.name}`} onClick={onStart}>
        <Play size={14} fill="currentColor" /><span>{inProgress ? 'Continue' : 'Start'}</span>
      </Button>}
    </div>

    {finished && <SlotFinished name={template.name} description="Restart or move to library." actions={actions} />}
  </section>;
}
