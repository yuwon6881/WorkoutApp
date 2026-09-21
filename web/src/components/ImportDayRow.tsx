import { useMemo, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DraftWorkout, Exercise } from '../types';
import { getWorkoutMuscles } from '../lib/muscles';
import { Button } from './ui/Button';
import { DayEditor } from './ImportDayEditor';

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
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
  handle?: ReactNode;
  menu?: ReactNode;
}) {
  const muscles = useMemo(() => getWorkoutMuscles(day.exercises, exercises), [day.exercises, exercises]);
  const exercisePreview = useMemo(() => {
    if (day.isRestDay || !day.exercises.length) return '';
    const names = day.exercises.map(exercise => exercise.sourceName);
    if (names.length <= 4) return names.join(', ');
    return `${names.slice(0, 4).join(', ')}, and ${names.length - 4} more`;
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
            {!expanded && exercisePreview && <span className="day-exercise-preview">{exercisePreview}</span>}
            <span className={`draft-day-disclosure ${expanded ? 'open' : ''}`} aria-hidden="true"><ChevronDown size={16} /></span>
          </Button>}
        {menu}
      </div>

      {expanded && !day.isRestDay && <>
        {muscles.length > 0 && <div className="day-muscles-row" aria-label="Targeted muscles">
          {muscles.map(muscle => <span key={muscle} className="muscle-chip">{muscle}</span>)}
        </div>}
        <DayEditor
          day={day}
          exercises={exercises}
          onChange={onChange}
          onPropagateSubstitution={onPropagateSubstitution}
          onMapExerciseSlot={onMapExerciseSlot}
          restorableExerciseLineIds={restorableExerciseLineIds}
          onRestoreExercise={onRestoreExercise}
        />
      </>}
    </section>
  );
}
