import { useMemo, type ReactNode } from 'react';
import { Moon } from 'lucide-react';
import type { DraftWorkout, Exercise } from '../types';
import { getPlannedMuscleCredits } from '../lib/programMuscles';
import type { ExerciseEditing } from '../lib/exerciseEditScope';
import { dayTitle, isGenericDayTitle } from '../lib/dayTitle';
import { Button } from './ui/Button';
import { ProgramMusclePreview } from './ProgramMusclePreview';
import './ProgramDayList.css';

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

  const rawTitle = dayTitle(day.name, index + 1);
  const isGenericDay = isGenericDayTitle(rawTitle);
  const isGenericRest = day.isRestDay && (isGenericDay || rawTitle.toLowerCase() === 'rest day');
  const dayNumber = index + 1;

  const displayTitle = day.isRestDay
    ? (isGenericRest ? `Day ${dayNumber}` : (rawTitle || day.name?.trim() || 'Rest day'))
    : (isGenericDay ? (day.name?.trim() || `Day ${dayNumber}`) : rawTitle);

  return (
    <section
      className={`draft-day pdl-day-card ${day.isRestDay ? 'rest-day pdl-rest-day' : ''}`}
      data-import-day={day.lineId}
    >
      <div className="draft-day-row pdl-day-row">
        {handle}
        {day.isRestDay ? (
          <div className="draft-day-summary draft-day-summary-static pdl-day-summary pdl-day-summary-static">
            <span className="pdl-day-badge pdl-day-badge-rest" aria-hidden="true">
              <Moon size={18} className="pdl-rest-icon" />
            </span>
            <div className="pdl-day-content">
              <div className="pdl-day-title-row">
                <strong className="pdl-day-title pdl-rest-title">{displayTitle}</strong>
                <span className="tiny-label rest-badge pdl-rest-badge">Rest day</span>
                {day.focus && <span className="day-focus-tag pdl-day-focus-tag">{day.focus}</span>}
              </div>
              <div className="pdl-day-meta pdl-rest-meta">
                <span>{day.focus ? `Day ${dayNumber} · ${day.focus}` : `Day ${dayNumber} · Recovery & rest`}</span>
              </div>
            </div>
          </div>
        ) : (
          <Button
            presentation="plain"
            className="draft-day-summary pdl-day-summary"
            aria-label={day.name?.trim() || `Day ${dayNumber}`}
            onClick={onOpen}
          >
            <span className="pdl-day-badge" aria-hidden="true">
              <span className="pdl-day-badge-prefix">Day</span>
              <span className="pdl-day-badge-number">{dayNumber}</span>
            </span>
            <div className="pdl-day-content">
              <div className="pdl-day-title-row">
                <strong className="pdl-day-title">{displayTitle}</strong>
                {day.focus && <span className="day-focus-tag pdl-day-focus-tag">{day.focus}</span>}
                {day.phase?.toLowerCase().includes('deload') && (
                  <span className="pill pill-accent pdl-day-deload-tag">Deload</span>
                )}
              </div>
              <div className="pdl-day-meta">
                <span className="tiny-label draft-day-count pdl-day-count">
                  {day.exercises.length} {day.exercises.length === 1 ? 'exercise' : 'exercises'}
                </span>
                {exercisePreview && (
                  <>
                    <span className="pdl-meta-sep" aria-hidden="true">·</span>
                    <span className="day-exercise-preview pdl-exercise-preview">
                      <span className="day-exercise-preview-full">{exercisePreview.full}</span>
                      <span className="day-exercise-preview-compact">{exercisePreview.compact}</span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </Button>
        )}
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
  editing,
  onCustomExerciseCreated,
  restorableExerciseLineIds,
  onRestoreExercise,
  DayEditorComponent,
  getRepRangeMemory,
  selectedMuscle,
  onMuscleSelect
}: {
  day: DraftWorkout;
  exercises: Exercise[];
  onChange: (day: DraftWorkout) => Promise<void>;
  editing: ExerciseEditing;
  onCustomExerciseCreated?: () => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
  getRepRangeMemory: (exerciseLineId: string) => Map<number, number>;
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
      editing={editing}
      onCustomExerciseCreated={onCustomExerciseCreated}
      restorableExerciseLineIds={restorableExerciseLineIds}
      onRestoreExercise={onRestoreExercise}
      getRepRangeMemory={getRepRangeMemory}
      selectedMuscle={selectedMuscle}
    />
  </>;
}
