import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Play, RefreshCw } from 'lucide-react';
import type { Exercise, ProgramSummary, Template, TemplateExercise } from '../types';
import { getPlannedMuscleCredits } from '../lib/programMuscles';
import { Button } from './ui/Button';
import { ProgramMusclePreview } from './ProgramMusclePreview';

/// The active program's current days grouped by block and phase, with start and swap actions.
export function ProgramDayTree({ days, completed, skipped, nextId, detail, exercises, onStart, canStart, onSwap }: {
  days: ProgramSummary['days'];
  completed: string[];
  skipped: string[];
  nextId: string | null;
  detail: Template[] | null;
  exercises: Exercise[];
  onStart: (id: string) => void;
  canStart: boolean;
  onSwap: (template: Template) => (exercise: TemplateExercise) => void;
}) {
  const blocks = new Map<string, Map<string, typeof days>>();
  for (const day of days) {
    const block = day.block || 'Program';
    const phase = day.phase || 'General';
    if (!blocks.has(block)) blocks.set(block, new Map());
    const phases = blocks.get(block)!;
    if (!phases.has(phase)) phases.set(phase, []);
    phases.get(phase)!.push(day);
  }
  return <div className="program-tree">{[...blocks].map(([block, phases]) => <details key={block} open>
    <summary>{block}</summary>
    {[...phases].map(([phase, phaseDays]) => <details key={phase} className="phase-tree" open>
      <summary>{phase}</summary>
      <div className="routine-list">{phaseDays.map(day => {
        const full = detail?.find(template => template.id === day.id);
        const complete = day.progressStatus === 'completed' || completed.includes(day.id);
        const isSkipped = day.progressStatus === 'skipped' || skipped.includes(day.id);
        const restPassed = day.progressStatus === 'rest_passed';
        return <ProgramSlotRow key={day.id} day={day} full={full} complete={complete} isSkipped={isSkipped} restPassed={restPassed}
          isNext={day.id === nextId} canStart={canStart} exercises={exercises} onStart={onStart} onSwap={full ? onSwap(full) : () => {}} />;
      })}</div>
    </details>)}
  </details>)}</div>;
}

function ProgramSlotRow({ day, full, complete, isSkipped, restPassed, isNext, canStart, exercises, onStart, onSwap }: {
  day: ProgramSummary['days'][number];
  full: Template | undefined;
  complete: boolean;
  isSkipped: boolean;
  restPassed: boolean;
  isNext: boolean;
  canStart: boolean;
  exercises: Exercise[];
  onStart: (id: string) => void;
  onSwap: (exercise: TemplateExercise) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const muscleSummary = useMemo(
    () => getPlannedMuscleCredits(full?.exercises ?? [], exercises),
    [full, exercises]
  );
  const preview = useMemo(() => {
    if (!full?.exercises?.length) return '';
    const names = full.exercises.map(e => e.name);
    if (names.length <= 4) return names.join(', ');
    return `${names.slice(0, 4).join(', ')}, and ${names.length - 4} more`;
  }, [full]);

  const actionable = canStart && !day.isRestDay && day.progressStatus === 'pending' && !complete && !isSkipped;
  const statusLabel = day.isRestDay ? restPassed ? 'Rest day passed' : 'Rest day' : complete ? 'Done' : isSkipped ? 'Skipped' : isNext ? 'Up next' : `${full?.exercises.length ?? day.exerciseCount} exercises`;

  const row = <>
    <span className="routine-number">W{day.phaseWeek}</span>
    <span>{day.name}</span>
    <span className="tiny-label">{statusLabel}</span>
  </>;

  if (day.isRestDay) return <div className="routine-row rest-row">{row}</div>;

  return <div className={`program-slot-card ${complete ? 'completed-slot' : ''} ${isNext ? 'next-slot' : ''}`}>
    <div className="program-slot-header">
      {actionable
        ? <Button variant="tertiary" className={`routine-row ${isNext ? 'next' : ''}`} onClick={() => onStart(day.id)}>{row}</Button>
        : <div className="routine-row routine-row-static">{row}</div>}
      <div className="program-slot-controls">
        {complete && <span className="slot-complete-badge" title="Workout completed"><Check size={16} /></span>}
        {actionable && <Button variant="primary" className="slot-start-btn" aria-label={`Start ${day.name}`} onClick={() => onStart(day.id)}><Play size={14} fill="currentColor" /><span>Start</span></Button>}
        {full && <Button variant="tertiary" aria-label={expanded ? `Hide details for ${day.name}` : `Show details for ${day.name}`} aria-expanded={expanded} onClick={() => setExpanded(e => !e)}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</Button>}
      </div>
    </div>
    {preview && <p className="day-exercise-preview">{preview}</p>}
    {expanded && full && <>
      <ProgramMusclePreview summary={muscleSummary} />
      {full.exercises.length > 0 && <div className="slot-exercises">
        {full.exercises.map(exercise => <Button key={exercise.id} variant="tertiary" aria-label={`Swap ${exercise.name} in ${day.name}`} onClick={() => onSwap(exercise)}><RefreshCw size={14} />{exercise.name}{exercise.canRestore ? ' · Swapped' : ''}</Button>)}
      </div>}
    </>}
  </div>;
}
