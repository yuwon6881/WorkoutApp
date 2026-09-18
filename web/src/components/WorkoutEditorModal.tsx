import { useMemo, useState } from 'react';
import { Dumbbell, Plus } from 'lucide-react';
import type { Exercise, SetPrescription, TemplateExercise } from '../types';
import { getWorkoutMuscles } from '../lib/muscles';
import { validateTemplateDraft } from '../lib/validation';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';
import { WorkoutPrescriptionCard } from './WorkoutPrescriptionCard';

export type WorkoutDraft = {
  id: string | null;
  name: string;
  focus: string;
  revision: number | null;
  exercises: TemplateExercise[];
};

export const blankSetPrescription = (loadModel?: Exercise['loadModel']): SetPrescription => ({
  repMin: 8,
  repMax: 12,
  targetRpe: 8,
  restSeconds: 90,
  tempo: null,
  loadText: null,
  notes: null,
  repsText: null,
  restText: null,
  rir: null,
  warmup: false,
  repsSource: 'userEdited',
  rpeSource: 'userEdited',
  restSource: 'userEdited',
  resistanceMode: loadModel === 'full_bodyweight'
    ? 'bodyweight'
    : loadModel === 'bodyweight_context_only' || loadModel === 'reps_only'
      ? 'reps_only'
      : 'external'
});

export function WorkoutEditorModal({
  initialDraft,
  exercises,
  busy,
  onSave,
  onDelete,
  onClose
}: {
  initialDraft: WorkoutDraft;
  exercises: Exercise[];
  busy: boolean;
  onSave: (draft: WorkoutDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<WorkoutDraft>(initialDraft);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const muscles = useMemo(
    () => getWorkoutMuscles(draft.exercises, exercises),
    [draft.exercises, exercises]
  );

  function updateSet(exerciseIndex: number, setIndex: number, patch: Partial<SetPrescription>) {
    setDraft(current => ({
      ...current,
      exercises: current.exercises.map((exercise, i) =>
        i === exerciseIndex
          ? {
              ...exercise,
              sets: exercise.sets.map((set, j) => (j === setIndex ? { ...set, ...patch } : set))
            }
          : exercise
      )
    }));
  }

  function addExercise(chosen: Exercise) {
    setDraft(current => ({
      ...current,
      exercises: [
        ...current.exercises,
        {
          id: crypto.randomUUID(),
          exerciseId: chosen.id,
          sourceName: chosen.name,
          name: chosen.name,
          note: '',
          position: current.exercises.length,
          sets: [
            blankSetPrescription(chosen.loadModel),
            blankSetPrescription(chosen.loadModel),
            blankSetPrescription(chosen.loadModel)
          ],
          sequenceGroup: '',
          substitutions: [],
          loadModel: chosen.loadModel
        }
      ]
    }));
    setPickerOpen(false);
  }

  async function handleSave() {
    const validationError = validateTemplateDraft(draft.name, draft.focus, draft.exercises);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    await onSave(draft);
  }

  return (
    <>
      <Modal
        title={draft.id ? `Edit ${draft.name || 'workout'}` : 'Build a workout'}
        onClose={onClose}
        wide
      >
        <div className="modal-body workout-builder-body">
          <div className="workout-builder-meta">
            <Field
              label="Workout name"
              value={draft.name}
              placeholder="e.g. Full Body Power or Push A"
              onChange={e => setDraft({ ...draft, name: e.target.value })}
            />
            <Field
              label="Focus"
              value={draft.focus}
              placeholder="e.g. Hypertrophy, Upper body, Strength"
              onChange={e => setDraft({ ...draft, focus: e.target.value })}
            />
          </div>

          {muscles.length > 0 && (
            <div className="workout-builder-muscles" aria-label="Targeted muscles in this workout">
              <span className="tiny-label">Targeted muscles</span>
              <div className="day-muscles-row">
                {muscles.map(m => (
                  <span key={m} className="muscle-chip">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="workout-builder-exercises">
            <div className="section-heading">
              <h3>Exercises ({draft.exercises.length})</h3>
              <Button
                variant="secondary"
                onClick={() => setPickerOpen(true)}
              >
                <Plus size={16} />
                Add exercise
              </Button>
            </div>

            {draft.exercises.length === 0 ? (
              <div className="empty-message">
                <Dumbbell size={28} />
                <h4>No exercises added yet</h4>
                <p>Add movements from the library to configure sets, reps, and RPE targets.</p>
                <Button variant="primary" onClick={() => setPickerOpen(true)}>
                  <Plus size={16} />
                  Choose from library
                </Button>
              </div>
            ) : (
              draft.exercises.map((exercise, ei) => (
                <WorkoutPrescriptionCard
                  key={exercise.id}
                  exercise={exercise}
                  index={ei}
                  exercises={exercises}
                  onUpdateExercise={patch =>
                    setDraft(curr => ({
                      ...curr,
                      exercises: curr.exercises.map((item, idx) =>
                        idx === ei ? { ...item, ...patch } : item
                      )
                    }))
                  }
                  onRemoveExercise={() =>
                    setDraft(curr => ({
                      ...curr,
                      exercises: curr.exercises.filter((_, idx) => idx !== ei)
                    }))
                  }
                  onOpenSwap={() => setSwapIndex(ei)}
                  onAddSet={() =>
                    setDraft(curr => ({
                      ...curr,
                      exercises: curr.exercises.map((item, idx) =>
                        idx === ei
                          ? {
                              ...item,
                              sets: [...item.sets, blankSetPrescription(item.loadModel)]
                            }
                          : item
                      )
                    }))
                  }
                  onUpdateSet={(si, patch) => updateSet(ei, si, patch)}
                  onRemoveSet={si =>
                    setDraft(curr => ({
                      ...curr,
                      exercises: curr.exercises.map((item, idx) =>
                        idx === ei
                          ? {
                              ...item,
                              sets: item.sets.filter((_, sidx) => sidx !== si)
                            }
                          : item
                      )
                    }))
                  }
                />
              ))
            )}
          </div>

          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>

        <div className="modal-actions">
          {draft.id && (
            <Button variant="destructive" disabled={busy} onClick={() => setDeleting(true)}>
              Delete workout
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={handleSave}>
            {busy ? 'Saving…' : 'Save workout'}
          </Button>
        </div>
      </Modal>

      {pickerOpen && (
        <Modal title="Add exercise to workout" wide onClose={() => setPickerOpen(false)}>
          <div className="modal-body">
            <ExerciseLibrary
              exercises={exercises}
              exclude={draft.exercises
                .map(e => e.exerciseId)
                .filter((id): id is string => id !== null)}
              onSelect={id => {
                const chosen = exercises.find(e => e.id === id);
                if (chosen) addExercise(chosen);
              }}
            />
          </div>
        </Modal>
      )}

      {swapIndex !== null && (
        <Modal
          title={`Swap ${draft.exercises[swapIndex]?.name ?? 'exercise'}`}
          onClose={() => setSwapIndex(null)}
        >
          <div className="modal-body">
            <p className="source">Sets, reps, notes, and targets stay with this slot.</p>
            <ExerciseLibrary
              action="swap"
              exercises={exercises}
              exclude={draft.exercises
                .map(e => e.exerciseId)
                .filter((id): id is string => id !== null)}
              onSelect={id => {
                const chosen = exercises.find(item => item.id === id);
                if (!chosen) return;
                setDraft(curr => ({
                  ...curr,
                  exercises: curr.exercises.map((item, idx) =>
                    idx === swapIndex
                      ? {
                          ...item,
                          exerciseId: chosen.id,
                          name: chosen.name,
                          sourceName: chosen.name,
                          loadModel: chosen.loadModel
                        }
                      : item
                  )
                }));
                setSwapIndex(null);
              }}
            />
          </div>
        </Modal>
      )}

      {deleting && draft.id && (
        <Modal title="Delete this workout?" onClose={() => setDeleting(false)}>
          <div className="modal-body">
            <p>Your completed sessions stay in your history.</p>
          </div>
          <div className="modal-actions">
            <Button onClick={() => setDeleting(false)}>Keep workout</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void onDelete(draft.id!)}>
              Delete workout
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
