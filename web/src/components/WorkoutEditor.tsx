import { Dumbbell, Plus } from 'lucide-react';
import type { Exercise, LoggedSet, Session, SessionExercise, Unit } from '../types';
import { blankLoggedSet, blankPrescription } from '../lib/workoutDraft';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';
import { WorkoutExerciseStrip } from './WorkoutExerciseStrip';
import { WorkoutActiveExercise } from './WorkoutActiveExercise';
import { useHorizontalSwipe } from './ui/useHorizontalSwipe';

type SetChange = { setId: string; patch: Partial<LoggedSet> };

export function WorkoutEditor({
  draft, unit, exercises, activeIndex, paused, finishIntentAt, recoveryConflict, online,
  picker, onPicker, onAddExercise, onChange, onEditSet, onToggleSet, onSelectExercise,
  onSwap, onRestore, onRemoveExercise, onCatalogChanged,
  onCatalogNeeded
}: {
  draft: Session; unit: Unit; exercises: Exercise[]; activeIndex: number; online: boolean;
  paused: boolean; finishIntentAt: string | null; recoveryConflict: boolean;
  picker: boolean; onPicker: (open: boolean) => void; onAddExercise: () => void; onChange: (next: Session, setChange?: SetChange) => void;
  onEditSet: (exerciseIndex: number, setIndex: number, patch: Partial<LoggedSet>) => void;
  onToggleSet: (exerciseIndex: number, setIndex: number) => void | boolean | Promise<void | boolean>; onSelectExercise: (index: number) => void;
  onSwap: (sessionExerciseId: string, replacementExerciseId: string | null, replacementName: string) => Promise<void>;
  onRestore: (sessionExerciseId: string) => Promise<void>; onRemoveExercise: (index: number) => void;
  onCatalogChanged?: () => void | Promise<void>;
  onCatalogNeeded?: () => Promise<void>;
}) {
  const currentExercise = draft.exercises[activeIndex] ?? draft.exercises[0];
  const currentIndex = currentExercise ? draft.exercises.indexOf(currentExercise) : -1;
  const showingExercise = !recoveryConflict && !finishIntentAt && !paused && Boolean(currentExercise);
  // One exercise is a page: a sideways swipe anywhere on the workout moves to the neighbouring one.
  const swipe = useHorizontalSwipe({
    enabled: showingExercise && draft.exercises.length > 1,
    onPrevious: () => { if (currentIndex > 0) onSelectExercise(currentIndex - 1); },
    onNext: () => { if (currentIndex >= 0 && currentIndex < draft.exercises.length - 1) onSelectExercise(currentIndex + 1); }
  });
  return <div className="workout-swipe-surface" inert={paused} {...swipe}>
    <WorkoutExerciseStrip exercises={draft.exercises} activeIndex={activeIndex} onSelect={onSelectExercise} onAdd={onAddExercise} />

    <div className="modal-body workout-body">
      {recoveryConflict ? <div className="empty-message"><h3>Review the saved versions</h3><p>Choose the server workout or apply this device’s copy after considering the changes.</p></div> : finishIntentAt ? <div className="empty-message"><h3>Workout finished</h3><p>Your completion time and workout are saved on this device. They will sync when the server is reachable.</p></div> : currentExercise ? (
        <WorkoutActiveExercise key={currentExercise.id} exercise={currentExercise} index={currentIndex}
          unit={unit} draft={draft} exercises={exercises} change={onChange} editSet={onEditSet} toggle={onToggleSet}
          onSwap={onSwap} onRestore={onRestore} onRemoveExercise={onRemoveExercise} onCatalogChanged={onCatalogChanged} onCatalogNeeded={onCatalogNeeded} />
      ) : (
        <div className="empty-message"><Dumbbell size={30} /><h3>No exercises in this workout</h3>
          <Button variant="primary" disabled={!online || paused || Boolean(finishIntentAt)} onClick={() => onPicker(true)}><Plus size={16} />Add an exercise</Button>
        </div>
      )}
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
  </div>;
}
