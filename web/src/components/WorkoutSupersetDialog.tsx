import type { Session, SessionExercise } from '../types';
import { getSupersetPartners, pairExercises, supersetLayout, unlinkExercise } from '../lib/supersets';
import { SupersetModal } from './SupersetModal';

/// The pill text naming which exercises this one alternates with, so two supersets are never confused.
export function workoutSupersetLabel(exercise: SessionExercise, draft: Session): string {
  const slot = supersetLayout(draft.exercises).get(exercise.id);
  const partnerNames = getSupersetPartners(exercise.id, draft.exercises).map(partner => partner.name).join(', ');
  return slot
    ? `Superset ${slot.group}${slot.position} of ${slot.size}${partnerNames ? ` with ${partnerNames}` : ''}`
    : `Superset ${exercise.sequenceGroup}`;
}

/// Pairing stays editable mid-workout: the same partner picker as the builder, saved through the
/// session's ordinary change path (which, like any exercise-list edit, needs a connection).
export function WorkoutSupersetDialog({
  exercise,
  draft,
  change,
  onClose
}: {
  exercise: SessionExercise;
  draft: Session;
  change: (next: Session) => void;
  onClose: () => void;
}) {
  return (
    <SupersetModal
      open
      onClose={onClose}
      currentExerciseId={exercise.id}
      currentExerciseName={exercise.name}
      currentSequenceGroup={exercise.sequenceGroup}
      candidates={draft.exercises.map(candidate => ({
        id: candidate.id, name: candidate.name, sequenceGroup: candidate.sequenceGroup
      }))}
      onPair={partnerId => change({ ...draft, exercises: pairExercises(draft.exercises, exercise.id, partnerId) })}
      onUnlink={() => change({ ...draft, exercises: unlinkExercise(draft.exercises, exercise.id) })}
    />
  );
}
