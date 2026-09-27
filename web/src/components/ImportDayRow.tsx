import { useMemo, type ReactNode } from 'react';
import type { DraftWorkout, Exercise } from '../types';
import { getPlannedMuscleCredits } from '../lib/programMuscles';
import { Button } from './ui/Button';
import { ProgramMusclePreview } from './ProgramMusclePreview';

/// One line per day when collapsed: what it is called, how much is in it and which exercises it
/// holds. Clicking a workout day opens a modal with the full details.
export function DayRow({
  day,
  index,
  onOpen,
  exercises: _exercises,
  handle,
  menu
}: {
  day: DraftWorkout;
  index: number;
  onOpen: () => void;
  exercises?: Exercise[];
  handle?: ReactNode;
  menu?: ReactNode;
}) {
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
          : <Button presentation="plain" className="draft-day-summary"
            aria-label={day.name} onClick={onOpen}>
            <span className="draft-day-heading">{meta}</span>
            {exercisePreview && <span className="day-exercise-preview">
              <span className="day-exercise-preview-full">{exercisePreview.full}</span>
              <span className="day-exercise-preview-compact">{exercisePreview.compact}</span>
            </span>}
          </Button>}
        {menu}
      </div>
    </section>
  );
}

/**
 * The content that was previously shown inline when a day row was expanded.
 * Now shown inside a modal, including muscle tiles and the day editor.
 */
export function DayDetailContent({
  day,
  exercises,
  onChange,
  onPropagateSubstitution,
  onMapExerciseSlot,
  onCustomExerciseCreated,
  restorableExerciseLineIds,
  onRestoreExercise,
  DayEditorComponent,
  selectedMuscle,
  onMuscleSelect
}: {
  day: DraftWorkout;
  exercises: Exercise[];
  onChange: (day: DraftWorkout) => Promise<void>;
  onPropagateSubstitution?: (currentName: string, replacementName: string, exerciseLineId?: string) => Promise<void>;
  onMapExerciseSlot?: (exerciseLineId: string, exerciseId: string | null) => Promise<void>;
  onCustomExerciseCreated?: () => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
  DayEditorComponent: typeof import('./ImportDayEditor').DayEditor;
  selectedMuscle: string | null;
  onMuscleSelect: (muscle: string | null) => void;
}) {
  const muscleSummary = useMemo(() => getPlannedMuscleCredits(day.exercises, exercises), [day.exercises, exercises]);

  return <>
    {day.exercises.length > 0 && (
      <div className="draft-day-muscles">
        <ProgramMusclePreview summary={muscleSummary} selectedMuscle={selectedMuscle} onMuscleSelect={onMuscleSelect} />
      </div>
    )}
    <DayEditorComponent
      day={day}
      exercises={exercises}
      onChange={onChange}
      onPropagateSubstitution={onPropagateSubstitution}
      onMapExerciseSlot={onMapExerciseSlot}
      onCustomExerciseCreated={onCustomExerciseCreated}
      restorableExerciseLineIds={restorableExerciseLineIds}
      onRestoreExercise={onRestoreExercise}
      selectedMuscle={selectedMuscle}
    />
  </>;
}
