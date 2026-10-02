import { useMemo } from 'react';
import type { DraftExercise, DraftWorkout, Exercise } from '../types';
import { exerciseCredits, getPlannedMuscleCredits } from '../lib/programMuscles';
import { getSupersetGroup } from '../lib/supersets';
import { summarizeSets } from '../lib/setSummary';
import { formatRest } from '../lib/training';
import { useTrackRir } from '../lib/trackRir';
import { ProgramMusclePreview } from './ProgramMusclePreview';

/// A library day shown as the program prints it. Nothing here is editable: a program only
/// becomes editable once it is moved into the active slot.
export function ReadOnlyDay({ day, exercises, selectedMuscle, onMuscleSelect }: {
  day: DraftWorkout;
  exercises: Exercise[];
  selectedMuscle: string | null;
  onMuscleSelect: (muscle: string | null) => void;
}) {
  const trackRir = useTrackRir();
  const muscleSummary = useMemo(() => getPlannedMuscleCredits(day.exercises, exercises), [day.exercises, exercises]);
  const catalogById = useMemo(() => new Map(exercises.map(e => [e.id, e])), [exercises]);
  const dimSet = useMemo(() => {
    if (!selectedMuscle) return null;
    const dimmed = new Set<string>();
    for (const ex of day.exercises) {
      const catalogExercise = ex.exerciseId ? catalogById.get(ex.exerciseId) : undefined;
      const credits = exerciseCredits(ex.sourceName, catalogExercise);
      if (!credits.has(selectedMuscle)) dimmed.add(ex.lineId);
    }
    return dimmed;
  }, [selectedMuscle, day.exercises, catalogById]);

  const groups = useMemo(() => {
    const result: DraftExercise[][] = [];
    for (const exercise of day.exercises) {
      const group = getSupersetGroup(exercise.sequenceGroup);
      const previous = result.at(-1);
      if (group && previous && getSupersetGroup(previous[0].sequenceGroup) === group) previous.push(exercise);
      else result.push([exercise]);
    }
    return result;
  }, [day.exercises]);

  if (!day.exercises.length) return <p className="muted">No exercises are scheduled for this day.</p>;

  return <>
    <div className="draft-day-muscles">
      <ProgramMusclePreview summary={muscleSummary} selectedMuscle={selectedMuscle} onMuscleSelect={onMuscleSelect} />
    </div>
    <ol className="readonly-day-exercises">
      {groups.map(group => <li key={group[0].lineId} className={group.length > 1 ? 'superset-block' : undefined}>
        {group.length > 1 && <div className="superset-heading">Superset {getSupersetGroup(group[0].sequenceGroup)}</div>}
        {group.map(exercise => (
          <ReadOnlyExercise
            key={exercise.lineId}
            exercise={exercise}
            trackRir={trackRir}
            dimmed={dimSet ? dimSet.has(exercise.lineId) : false}
          />
        ))}
      </li>)}
    </ol>
  </>;
}

function ReadOnlyExercise({ exercise, trackRir, dimmed }: { exercise: DraftExercise; trackRir: boolean; dimmed: boolean }) {
  const lines = summarizeSets(exercise.sets, trackRir);
  const rest = exercise.restSeconds ?? exercise.sets.find(set => !set.warmup)?.restSeconds ?? null;
  return <div className={`readonly-exercise ${dimmed ? 'exercise-dimmed' : ''}`}>
    <div className="readonly-exercise-head">
      <strong className="readonly-exercise-name">{exercise.sourceName}</strong>
      {rest != null && <span className="readonly-exercise-rest">Rest {formatRest(rest)}</span>}
    </div>
    {lines.length > 0 && <ul className="readonly-exercise-sets">
      {lines.map((line, index) => <li key={index}>
        <span className="readonly-set-count">{line.count} ×</span>
        <span className="readonly-set-target">{line.target}</span>
        {line.warmup && <span className="tiny-label readonly-warmup-label">Warm-up</span>}
      </li>)}
    </ul>}
    {exercise.notes && <p className="readonly-exercise-note">{exercise.notes}</p>}
  </div>;
}
