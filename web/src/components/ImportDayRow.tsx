import { useMemo, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DraftWorkout, Exercise } from '../types';
import { getPlannedMuscleCredits } from '../lib/programMuscles';
import { Button } from './ui/Button';
import { DayEditor } from './ImportDayEditor';
import { ProgramMusclePreview } from './ProgramMusclePreview';

/// One line per day when collapsed: what it is called, how much is in it and which exercises it
/// holds. Everything else — muscles, prescriptions, editing — waits until the day is opened, so a
/// full week stays readable on one screen.
export function DayRow({
  day,
  index,
  expanded,
  onToggle,
  exercises,
  onChange,
  onPropagateSubstitution,
  onMapExerciseSlot,
  onCustomExerciseCreated,
  restorableExerciseLineIds,
  onRestoreExercise,
  handle,
  menu
}: {
  day: DraftWorkout;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  exercises: Exercise[];
  onChange: (day: DraftWorkout) => Promise<void>;
  onPropagateSubstitution?: (currentName: string, replacementName: string, exerciseLineId?: string) => Promise<void>;
  onMapExerciseSlot?: (exerciseLineId: string, exerciseId: string | null) => Promise<void>;
  onCustomExerciseCreated?: () => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
  handle?: ReactNode;
  menu?: ReactNode;
}) {
  const muscleSummary = useMemo(() => getPlannedMuscleCredits(day.exercises, exercises), [day.exercises, exercises]);
  const exercisePreview = useMemo(() => {
    if (day.isRestDay || !day.exercises.length) return null;
    const names = day.exercises.map(exercise => exercise.sourceName);
    const list = (shown: number) => names.length <= shown
      ? names.join(', ')
      : `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
    // A phone row has room for one name before it wraps, so it leads with the first exercise.
    return { full: list(4), compact: list(1) };
  }, [day.exercises, day.isRestDay]);

  const isGenericDay = !day.name
    || day.name.trim().toLowerCase() === `day ${index + 1}`.toLowerCase()
    || /^(day\s*\d+)$/i.test(day.name.trim());
  const isGenericRest = day.isRestDay && (isGenericDay || day.name.trim().toLowerCase() === 'rest day');

  const meta = <>
    {!day.isRestDay && (isGenericDay
      ? <strong>{day.name || `Day ${index + 1}`}</strong>
      : <>
        <span className="draft-day-index">Day {index + 1}</span>
        <strong>{day.name}</strong>
      </>)}
    {day.isRestDay && (isGenericRest
      ? <>
        <span className="draft-day-index">Day {index + 1}</span>
        <span className="tiny-label rest-badge">Rest day</span>
      </>
      : <>
        <span className="draft-day-index">Day {index + 1}</span>
        <strong>{day.name}</strong>
        <span className="tiny-label rest-badge">Rest day</span>
      </>)}
    {!day.isRestDay && (
      <span className="tiny-label">{day.exercises.length} {day.exercises.length === 1 ? 'exercise' : 'exercises'}</span>
    )}
    {day.focus && <span className="day-focus-tag">{day.focus}</span>}
    {day.phase?.toLowerCase().includes('deload') && <span className="pill pill-accent">Deload</span>}
  </>;

  return (
    <section className={`draft-day ${day.isRestDay ? 'rest-day' : ''}`} data-import-day={day.lineId}>
      <div className="draft-day-row">
        {handle}
        {day.isRestDay
          ? <div className="draft-day-summary draft-day-summary-static">
            <span className="draft-day-heading">{meta}</span>
          </div>
          : <Button presentation="plain" className="draft-day-summary" aria-expanded={expanded}
            aria-label={day.name} onClick={onToggle}>
            <span className="draft-day-heading">{meta}</span>
            {!expanded && exercisePreview && <span className="day-exercise-preview">
              <span className="day-exercise-preview-full">{exercisePreview.full}</span>
              <span className="day-exercise-preview-compact">{exercisePreview.compact}</span>
            </span>}
            <span className={`draft-day-disclosure ${expanded ? 'open' : ''}`} aria-hidden="true"><ChevronDown size={16} /></span>
          </Button>}
        {menu}
      </div>

      {expanded && !day.isRestDay && <>
        {day.exercises.length > 0 && <div className="draft-day-muscles"><ProgramMusclePreview summary={muscleSummary} /></div>}
        <DayEditor
          day={day}
          exercises={exercises}
          onChange={onChange}
          onPropagateSubstitution={onPropagateSubstitution}
          onMapExerciseSlot={onMapExerciseSlot}
          onCustomExerciseCreated={onCustomExerciseCreated}
          restorableExerciseLineIds={restorableExerciseLineIds}
          onRestoreExercise={onRestoreExercise}
        />
      </>}
    </section>
  );
}
