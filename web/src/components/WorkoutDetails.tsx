import { Dumbbell, TrendingUp } from 'lucide-react';
import type { Session, Unit } from '../types';
import { showVolume, showWeight } from '../lib/training';
import { getProgressionSummary } from '../lib/progressionSummary';
import { Modal } from './ui/Modal';
import { WorkoutElapsed } from './WorkoutElapsed';

/// What the workout is based on and has lifted so far. It sits behind the workout's options menu
/// because none of it is needed between sets, and a row of figures cost the sets room to breathe.
/// Volume is only listed once something has been lifted, and an unknown load stays absent rather
/// than reading as zero.
export function hasWorkoutDetails(draft: Session): boolean {
  return draft.exercises.length > 0 || (draft.volumeKg ?? 0) > 0 || Boolean(draft.bodyWeight) || getProgressionSummary(draft) !== null;
}

export function WorkoutDetailsModal({ draft, unit, onClose }: { draft: Session; unit: Unit; onClose: () => void }) {
  const liftedKg = draft.volumeKg ?? 0;
  const withBodyweightKg = draft.systemVolumeKg ?? null;
  const progression = getProgressionSummary(draft);
  const loggedWorkingSets = draft.exercises.flatMap(exercise => exercise.sets).filter(set => set.done && !set.warmup).length;

  return <Modal title="Workout details" onClose={onClose}>
    <div className="modal-body workout-details">
      <div className="workout-details-summary">
        <strong>{draft.name}</strong>
        <span><WorkoutElapsed session={draft} finishedAt={null} />{draft.pausedAt && ' / Paused'}</span>
        <span>{loggedWorkingSets} working {loggedWorkingSets === 1 ? 'set' : 'sets'} logged / {draft.exercises.length} {draft.exercises.length === 1 ? 'exercise' : 'exercises'}</span>
      </div>
      {liftedKg > 0 && <p><Dumbbell size={16} aria-hidden="true" /><span><strong>{showVolume(liftedKg, unit)} lifted</strong>
        <small>Load lifted in completed working sets.</small></span></p>}
      {withBodyweightKg !== null && withBodyweightKg > liftedKg && <p><Dumbbell size={16} aria-hidden="true" /><span><strong>{showVolume(withBodyweightKg, unit)} with bodyweight</strong>
        <small>Including your bodyweight on bodyweight movements.</small></span></p>}
      {draft.bodyWeight && <p><Dumbbell size={16} aria-hidden="true" /><span><strong>Bodyweight {showWeight(draft.bodyWeight.referenceKg, unit)}</strong>
        <small>Recorded when this workout started.</small></span></p>}
      {progression && <p className="workout-details-progression"><TrendingUp size={16} aria-hidden="true" /><span><strong>{progression.label}</strong>
        <small className="workout-context-source">Nutrition context: {progression.nutritionStatus}</small>
        <small>{progression.reason}</small>
        {progression.nutritionStatus === 'cached' && <small>This decision used the saved Nutrition snapshot available when the workout started.</small>}</span></p>}
    </div>
  </Modal>;
}
