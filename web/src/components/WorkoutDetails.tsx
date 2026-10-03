import { Dumbbell, TrendingUp } from 'lucide-react';
import type { Session, Unit } from '../types';
import { showVolume, showWeight } from '../lib/training';
import { getProgressionSummary } from '../lib/progressionSummary';
import { Modal } from './ui/Modal';

/// What the workout is based on and has lifted so far. It sits behind the workout's options menu
/// because none of it is needed between sets, and a row of figures cost the sets room to breathe.
/// Volume is only listed once something has been lifted, and an unknown load stays absent rather
/// than reading as zero.
export function hasWorkoutDetails(draft: Session): boolean {
  return (draft.volumeKg ?? 0) > 0 || Boolean(draft.bodyWeight) || getProgressionSummary(draft) !== null;
}

export function WorkoutDetailsModal({ draft, unit, onClose }: { draft: Session; unit: Unit; onClose: () => void }) {
  const liftedKg = draft.volumeKg ?? 0;
  const withBodyweightKg = draft.systemVolumeKg ?? null;
  const progression = getProgressionSummary(draft);

  return <Modal title="Workout details" onClose={onClose}>
    <div className="modal-body workout-details">
      {liftedKg > 0 && <p><Dumbbell size={16} aria-hidden="true" /><span><strong>{showVolume(liftedKg, unit)} lifted</strong>
        <small>Load lifted in completed working sets.</small></span></p>}
      {withBodyweightKg !== null && withBodyweightKg > liftedKg && <p><Dumbbell size={16} aria-hidden="true" /><span><strong>{showVolume(withBodyweightKg, unit)} with bodyweight</strong>
        <small>Including your bodyweight on bodyweight movements.</small></span></p>}
      {draft.bodyWeight && <p><Dumbbell size={16} aria-hidden="true" /><span><strong>Bodyweight {showWeight(draft.bodyWeight.referenceKg, unit)}</strong>
        <small>Recorded when this workout started.</small></span></p>}
      {progression && <p><TrendingUp size={16} aria-hidden="true" /><span><strong>{progression.label}</strong>
        <small>{progression.reason}</small>
        {progression.nutritionStatus === 'cached' && <small>This decision used the saved Nutrition snapshot available when the workout started.</small>}</span></p>}
    </div>
  </Modal>;
}
