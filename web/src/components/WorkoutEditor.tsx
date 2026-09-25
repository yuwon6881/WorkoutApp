import { Dumbbell, Plus } from 'lucide-react';
import type { Exercise, LoggedSet, Session, SessionExercise, Unit } from '../types';
import { showVolume, showWeight } from '../lib/training';
import { blankLoggedSet, blankPrescription } from '../lib/workoutDraft';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';
import { WorkoutExerciseStrip } from './WorkoutExerciseStrip';
import { WorkoutActiveExercise } from './WorkoutActiveExercise';

type SetChange = { setId: string; patch: Partial<LoggedSet> };

export function WorkoutEditor({
  draft, unit, exercises, activeIndex, viewMode, paused, finishIntentAt, recoveryConflict, online,
  picker, onPicker, onAddExercise, onChange, onEditSet, onToggleSet, onSelectExercise,
  onSwap, onRestore, onRemoveExercise
}: {
  draft: Session; unit: Unit; exercises: Exercise[]; activeIndex: number; viewMode: 'focus' | 'all'; online: boolean;
  paused: boolean; finishIntentAt: string | null; recoveryConflict: boolean;
  picker: boolean; onPicker: (open: boolean) => void; onAddExercise: () => void; onChange: (next: Session, setChange?: SetChange) => void;
  onEditSet: (exerciseIndex: number, setIndex: number, patch: Partial<LoggedSet>) => void;
  onToggleSet: (exerciseIndex: number, setIndex: number) => void; onSelectExercise: (index: number) => void;
  onSwap: (sessionExerciseId: string, replacementExerciseId: string | null, replacementName: string) => Promise<void>;
  onRestore: (sessionExerciseId: string) => Promise<void>; onRemoveExercise: (index: number) => void;
}) {
  const currentExercise = draft.exercises[activeIndex] ?? draft.exercises[0];
  // Volume is only worth a chip once something has been lifted; an unknown load stays unknown
  // rather than reading as zero, so the chip is simply absent until a load is recorded.
  const liftedKg = draft.volumeKg ?? 0;
  const withBodyweightKg = draft.systemVolumeKg ?? null;

  return <>
    {(liftedKg > 0 || draft.bodyWeight || draft.nutritionContext?.cached) && <div className="workout-summary">
      {liftedKg > 0 && <span title="Load lifted in completed working sets"><Dumbbell size={15} aria-hidden="true" />{showVolume(liftedKg, unit)} lifted</span>}
      {withBodyweightKg !== null && withBodyweightKg > liftedKg && <span title="Including your bodyweight on bodyweight movements">{showVolume(withBodyweightKg, unit)} with bodyweight</span>}
      {draft.bodyWeight && <span title="Recorded when this workout started">Bodyweight {showWeight(draft.bodyWeight.referenceKg, unit)}</span>}
      {draft.nutritionContext?.cached && <span title="Nutrition was unavailable when this workout started">Using saved nutrition data</span>}
    </div>}

    <WorkoutExerciseStrip exercises={draft.exercises} activeIndex={activeIndex} onSelect={onSelectExercise} onAdd={onAddExercise} />

    <div className="modal-body workout-body">
      {recoveryConflict ? <div className="empty-message"><h3>Review the saved versions</h3><p>Choose the server workout or apply this device’s copy after considering the changes.</p></div> : finishIntentAt ? <div className="empty-message"><h3>Workout finished</h3><p>Your completion time and workout are saved on this device. They will sync when the server is reachable.</p></div> : paused ? <div className="empty-message"><h3>Workout paused</h3><p>Your active duration and rest timer are paused. Resume when you are ready.</p></div> : viewMode === 'focus' ? (
        currentExercise ? <WorkoutActiveExercise key={currentExercise.id} exercise={currentExercise} index={draft.exercises.indexOf(currentExercise)}
          unit={unit} draft={draft} exercises={exercises} change={onChange} editSet={onEditSet} toggle={onToggleSet}
          onSwap={onSwap} onRestore={onRestore} onRemoveExercise={onRemoveExercise} /> :
          <div className="empty-message"><Dumbbell size={30} /><h3>No exercises in this workout</h3>
            <Button variant="primary" disabled={!online || paused || Boolean(finishIntentAt)} onClick={() => onPicker(true)}><Plus size={16} />Add an exercise</Button>
          </div>
      ) : (
        <div className="workout-all-exercises-list">
          {draft.exercises.map((exercise, index) => <WorkoutActiveExercise key={exercise.id} exercise={exercise} index={index}
            unit={unit} draft={draft} exercises={exercises} change={onChange} editSet={onEditSet} toggle={onToggleSet}
            onSwap={onSwap} onRestore={onRestore} onRemoveExercise={onRemoveExercise} />)}
          <Button className="full-width" disabled={!online || paused || Boolean(finishIntentAt)} onClick={() => onPicker(true)}><Plus size={18} />Add exercise</Button>
        </div>
      )}

      {!paused && !finishIntentAt && !recoveryConflict && <label className="field workout-global-notes">Workout notes
        <textarea name="workout-note" placeholder="How did the session feel? Overall fatigue, grip, energy…" value={draft.note}
          onChange={event => onChange({ ...draft, note: event.target.value })} />
      </label>}
    </div>

    {picker && <Modal title="Add an exercise" onClose={() => onPicker(false)}>
      <div className="modal-body"><ExerciseLibrary exercises={exercises} exclude={draft.exercises.map(exercise => exercise.exerciseId).filter((id): id is string => id !== null)}
        onSelect={id => {
          const chosen = exercises.find(exercise => exercise.id === id)!;
          const newExercise: SessionExercise = {
            id: crypto.randomUUID(), exerciseId: chosen.id, name: chosen.name, position: draft.exercises.length,
            note: '', sequenceGroup: '', substitutions: [], prescription: [blankPrescription(90, chosen.loadModel)],
            sets: [blankLoggedSet(chosen.loadModel)],
            progression: null, loadModel: chosen.loadModel
          };
          onChange({ ...draft, exercises: [...draft.exercises, newExercise] });
          onSelectExercise(draft.exercises.length);
          onPicker(false);
        }} />
      </div>
    </Modal>}
  </>;
}
