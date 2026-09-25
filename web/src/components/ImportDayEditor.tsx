import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { DraftExercise, DraftWorkout, Exercise } from '../types';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { pairExercises, unlinkExercise } from '../lib/supersets';
import { ExerciseEditor, blankExercise } from './ImportExerciseEditor';

export function DayEditor({ day, exercises, onChange, onPropagateSubstitution, onMapExerciseSlot, onCustomExerciseCreated, restorableExerciseLineIds, onRestoreExercise }: {
  day: DraftWorkout;
  exercises: Exercise[];
  onChange: (day: DraftWorkout) => Promise<void>;
  onPropagateSubstitution?: (currentName: string, replacementName: string, exerciseLineId?: string) => Promise<void>;
  onMapExerciseSlot?: (exerciseLineId: string, exerciseId: string | null) => Promise<void>;
  onCustomExerciseCreated?: () => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(day);
  useEffect(() => setDraft(day), [day]);

  const save = (next: DraftWorkout) => {
    setDraft(next);
    void onChange(next);
  };

  const groups: DraftExercise[][] = [];
  for (const exercise of draft.exercises) {
    const prefix = exercise.sequenceGroup.trim().match(/^[A-Za-z]+/)?.[0] ?? '';
    const previous = groups.at(-1)?.[0]?.sequenceGroup.match(/^[A-Za-z]+/)?.[0] ?? '';
    if (prefix && prefix === previous) groups.at(-1)!.push(exercise);
    else groups.push([exercise]);
  }

  const handlePairExercises = (idA: string, idB: string) => {
    const updated = pairExercises(
      draft.exercises.map(e => ({ ...e, id: e.lineId })),
      idA,
      idB
    ).map(e => ({ ...e, lineId: e.id }));
    save({ ...draft, exercises: updated });
  };

  const handleUnlinkExercise = (id: string) => {
    const updated = unlinkExercise(
      draft.exercises.map(e => ({ ...e, id: e.lineId })),
      id
    ).map(e => ({ ...e, lineId: e.id }));
    save({ ...draft, exercises: updated });
  };

  const handleRemoveExercise = (lineId: string) => {
    if (draft.exercises.length <= 1) return;
    const unlinked = unlinkExercise(
      draft.exercises.map(e => ({ ...e, id: e.lineId })),
      lineId
    ).map(e => ({ ...e, lineId: e.id }));
    const remaining = unlinked.filter(e => e.lineId !== lineId);
    save({ ...draft, exercises: remaining });
  };

  return <div className="day-editor">
    <div className="day-editor-fields">
      <Field name={`day-name-${draft.lineId}`} className="day-name-field" label="Day name" value={draft.name} data-import-field="name"
        onChange={event => setDraft({ ...draft, name: event.target.value })}
        onBlur={() => void onChange(draft)} />
    </div>
    {draft.isRestDay
      ? <div className="rest-callout"><span className="tiny-label">Rest day</span><p>No exercises are scheduled for this slot.</p></div>
      : groups.map((group, groupIndex) => <div className={group.length > 1 ? 'superset-block' : ''} key={groupIndex}>
        {group.length > 1 && <div className="superset-heading">Superset {group[0].sequenceGroup.match(/^[A-Za-z]+/)?.[0] ?? ''}</div>}
        {group.map(exercise => <ExerciseEditor key={exercise.lineId} exercise={exercise} exercises={exercises} allDayExercises={draft.exercises}
          onChange={next => save({ ...draft, exercises: draft.exercises.map(item => item.lineId === next.lineId ? next : item) })}
          onRemove={() => handleRemoveExercise(exercise.lineId)}
          onPairExercises={targetLineId => handlePairExercises(exercise.lineId, targetLineId)}
          onUnlinkExercise={() => handleUnlinkExercise(exercise.lineId)}
          onPropagateSubstitution={onPropagateSubstitution}
          onMapExerciseSlot={onMapExerciseSlot}
          onCustomExerciseCreated={onCustomExerciseCreated}
          canRestore={restorableExerciseLineIds?.includes(exercise.lineId)}
          onRestore={onRestoreExercise ? () => onRestoreExercise(exercise.lineId) : undefined} />)}
      </div>)}
    {!draft.isRestDay && <Button variant="tertiary" className="day-add-exercise-button" onClick={() => save({ ...draft, exercises: [...draft.exercises, blankExercise()] })}>
      <Plus size={16} />Add exercise
    </Button>}
  </div>;
}
