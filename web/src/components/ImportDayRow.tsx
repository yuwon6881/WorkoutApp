import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import type { DraftWorkout, Exercise } from '../types';
import { getWorkoutMuscles } from '../lib/muscles';
import { Button } from './ui/Button';
import { DayEditor, exerciseSummary } from './ImportDayEditor';

function DayLines({ day }: { day: DraftWorkout }) {
  return (
    <ol className="draft-day-lines">
      {day.exercises.map(exercise => (
        <li key={exercise.lineId}>
          {exercise.sequenceGroup && <span className="draft-line-group">{exercise.sequenceGroup}</span>}
          <span className="draft-line-name">{exercise.sourceName}</span>
          <span className="draft-line-detail">{exerciseSummary(exercise)}</span>
        </li>
      ))}
    </ol>
  );
}

export function DayRow({
  day,
  expanded,
  onToggle,
  exercises,
  onChange,
  onPropagateSubstitution,
  onMapExerciseSlot,
  restorableExerciseLineIds,
  onRestoreExercise
}: {
  day: DraftWorkout;
  expanded: boolean;
  onToggle: () => void;
  exercises: Exercise[];
  onChange: (day: DraftWorkout) => Promise<void>;
  onPropagateSubstitution?: (currentName: string, replacementName: string, exerciseLineId?: string) => Promise<void>;
  onMapExerciseSlot?: (exerciseLineId: string, exerciseId: string | null) => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const muscles = useMemo(() => getWorkoutMuscles(day.exercises, exercises), [day.exercises, exercises]);
  const exercisePreview = useMemo(() => {
    if (day.isRestDay || !day.exercises.length) return '';
    const names = day.exercises.map(e => e.sourceName);
    if (names.length <= 4) return names.join(', ');
    return `${names.slice(0, 4).join(', ')}, and ${names.length - 4} more`;
  }, [day.exercises, day.isRestDay]);

  const fullName = day.name;

  return (
    <section className={`draft-day ${day.isRestDay ? 'rest-day' : ''}`} data-import-day={day.lineId}>
      <div className="draft-day-card-header">
        {day.isRestDay ? (
          <div className="draft-day-summary draft-day-summary-static">
            <div className="draft-day-title-group">
              <strong>{fullName}</strong>
              {(day.focus || day.phase?.toLowerCase().includes('deload')) && (
                <div className="draft-day-meta-tags">
                  {day.focus && <span className="day-focus-tag">{day.focus}</span>}
                  {day.phase?.toLowerCase().includes('deload') && <span className="pill pill-accent">Deload</span>}
                </div>
              )}
            </div>
          </div>
        ) : (
          <Button presentation="plain" className="draft-day-summary" aria-expanded={expanded} aria-label={fullName} onClick={onToggle}>
            <span className={`draft-day-disclosure ${expanded ? 'open' : ''}`} aria-hidden="true"><ChevronDown size={17} /></span>
            <div className="draft-day-title-group">
              <strong>{fullName}</strong>
              <div className="draft-day-meta-tags">
                <span className="tiny-label">{`${day.exercises.length} exercises`}</span>
                {day.focus && <span className="day-focus-tag">{day.focus}</span>}
                {day.phase?.toLowerCase().includes('deload') && <span className="pill pill-accent">Deload</span>}
              </div>
            </div>
          </Button>
        )}
        <div className="draft-day-actions">
          {day.isRestDay ? (
            <span className="tiny-label rest-badge">Rest day</span>
          ) : (
            <>
              <Button variant="secondary" className="day-action-button" aria-label={expanded ? `Close editor for ${day.name}` : `Edit ${day.name}`} onClick={onToggle}>
                <Pencil size={14} /><span>{expanded ? 'Close' : 'Edit'}</span>
              </Button>
              {!expanded && day.exercises.length > 0 && (
                <Button
                  variant="tertiary"
                  className="day-chevron-button"
                  aria-label={showDetails ? `Hide details for ${day.name}` : `View details for ${day.name}`}
                  onClick={e => {
                    e.stopPropagation();
                    setShowDetails(s => !s);
                  }}
                >
                  {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {!expanded && !day.isRestDay && (
        <div className="draft-day-compact-body">
          {exercisePreview && <p className="day-exercise-preview">{exercisePreview}</p>}
          {muscles.length > 0 && (
            <div className="day-muscles-row" aria-label="Targeted muscles">
              {muscles.slice(0, 5).map(m => (
                <span key={m} className="muscle-chip">{m}</span>
              ))}
              {muscles.length > 5 && (
                <span className="muscle-chip muscle-chip-overflow" title={muscles.slice(5).join(', ')}>
                  +{muscles.length - 5}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {!expanded && showDetails && !day.isRestDay && day.exercises.length > 0 && <DayLines day={day} />}
      {expanded && !day.isRestDay && (
        <DayEditor
          day={day}
          exercises={exercises}
          onChange={onChange}
          onPropagateSubstitution={onPropagateSubstitution}
          onMapExerciseSlot={onMapExerciseSlot}
          restorableExerciseLineIds={restorableExerciseLineIds}
          onRestoreExercise={onRestoreExercise}
        />
      )}
    </section>
  );
}
