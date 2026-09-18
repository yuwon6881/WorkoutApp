import { AlertTriangle, Dumbbell, FileText, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { Exercise, SetPrescription, TemplateExercise } from '../types';
import { rpeOptions } from '../lib/training';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { Select } from './ui/Select';
import { SwipeableRow } from './ui/SwipeableRow';

export function WorkoutPrescriptionCard({
  exercise,
  index,
  exercises,
  onUpdateExercise,
  onRemoveExercise,
  onOpenSwap,
  onAddSet,
  onUpdateSet,
  onRemoveSet
}: {
  exercise: TemplateExercise;
  index: number;
  exercises: Exercise[];
  onUpdateExercise: (patch: Partial<TemplateExercise>) => void;
  onRemoveExercise: () => void;
  onOpenSwap: () => void;
  onAddSet: () => void;
  onUpdateSet: (setIndex: number, patch: Partial<SetPrescription>) => void;
  onRemoveSet: (setIndex: number) => void;
}) {
  const linked = exercises.find(item => item.id === exercise.exerciseId);

  return (
    <div className="import-exercise workout-builder-exercise-card" key={exercise.id}>
      <div className="import-exercise-heading">
        <div className="import-exercise-title">
          <span className="import-exercise-icon" aria-hidden="true">
            <Dumbbell size={17} />
          </span>
          <input
            className="inline-input"
            aria-label={`Name for exercise ${index + 1}`}
            value={exercise.name}
            onChange={e => onUpdateExercise({ name: e.target.value, sourceName: e.target.value })}
          />
        </div>
        <div className="topbar-actions">
          {!exercise.exerciseId && (
            <span className="tiny-label warn">
              <AlertTriangle size={12} /> Unmapped
            </span>
          )}
          <Button variant="tertiary" aria-label={`Swap ${exercise.name}`} onClick={onOpenSwap}>
            <RefreshCw size={14} />
            Swap
          </Button>
          <Button variant="tertiary" aria-label={`Remove ${exercise.name}`} onClick={onRemoveExercise}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      <div className="import-fields">
        <div className="field import-library-field">
          <span>Library mapping</span>
          <Button
            variant="secondary"
            className="import-library-trigger"
            aria-label={`Library exercise for ${exercise.name}`}
            onClick={onOpenSwap}
          >
            {linked?.name ?? 'Map to library'}
          </Button>
        </div>
        <label className="field import-superset-field">
          Superset group
          <input
            value={exercise.sequenceGroup}
            placeholder="e.g. A1, B2"
            onChange={e => onUpdateExercise({ sequenceGroup: e.target.value })}
          />
        </label>
        <label className="field import-substitutions-field">
          Substitutions
          <input
            value={exercise.substitutions.join(', ')}
            placeholder="Optional alternates"
            onChange={e =>
              onUpdateExercise({
                substitutions: e.target.value
                  .split(',')
                  .map(v => v.trim())
                  .filter(Boolean)
                  .slice(0, 2)
              })
            }
          />
        </label>
      </div>

      <TextAreaField
        className="import-exercise-notes"
        label={
          <span className="import-note-label">
            <FileText size={15} />
            Coaching notes
          </span>
        }
        value={exercise.note}
        placeholder="Cues, setups or coaching notes for this exercise"
        onChange={e => onUpdateExercise({ note: e.target.value })}
      />

      <ol className="import-sets" aria-label={`Prescription sets for ${exercise.name}`}>
        {exercise.sets.map((set, si) => {
          const removeAction = (
            <Button
              variant="destructive"
              className="import-set-remove"
              aria-label={`Remove set ${si + 1}`}
              disabled={exercise.sets.length <= 1}
              onClick={() => onRemoveSet(si)}
            >
              <Trash2 size={15} />
              <span>Delete</span>
            </Button>
          );

          return (
            <li className={`import-set ${set.warmup ? 'warmup-row' : ''}`} key={si}>
              <SwipeableRow
                className="import-set-swipe-row"
                actions={removeAction}
                desktopActions={removeAction}
                actionsWidth={88}
                actionsLabel={`Actions for set ${si + 1}`}
              >
                <div className="import-set-content">
                  <div className="import-set-heading">
                    <span className="set-number">
                      <span className="set-number-label">{set.warmup ? 'Warm-up' : 'Set'}</span>
                      <strong>{si + 1}</strong>
                    </span>
                    <label className="checkbox-field set-warmup-toggle">
                      <input
                        type="checkbox"
                        checked={set.warmup}
                        onChange={e =>
                          onUpdateSet(si, {
                            warmup: e.target.checked,
                            targetRpe: e.target.checked ? null : set.targetRpe ?? 8
                          })
                        }
                      />
                      Warm-up
                    </label>
                  </div>
                  <div className="import-set-fields">
                    <Field
                      label="Min reps"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="1000"
                      value={set.repMin}
                      onChange={e =>
                        onUpdateSet(si, {
                          repMin: Number(e.target.value),
                          repMax: Math.max(Number(e.target.value), set.repMax)
                        })
                      }
                    />
                    <Field
                      label="Max reps"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="1000"
                      value={set.repMax}
                      onChange={e => onUpdateSet(si, { repMax: Number(e.target.value) })}
                    />
                    <label className="field">
                      Target RPE
                      <Select
                        name={`target-rpe-${exercise.id}-${si}`}
                        ariaLabel={`${exercise.name} set ${si + 1} target RPE`}
                        value={set.targetRpe ?? ''}
                        options={[
                          { value: '', label: set.warmup ? 'Not set' : 'Choose RPE' },
                          ...rpeOptions
                        ]}
                        onChange={val =>
                          onUpdateSet(si, {
                            targetRpe: val === '' ? null : Number(val)
                          })
                        }
                      />
                    </label>
                    <Field
                      label="Rest (s)"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="3600"
                      value={set.restSeconds ?? ''}
                      onChange={e =>
                        onUpdateSet(si, {
                          restSeconds: e.target.value === '' ? null : Number(e.target.value)
                        })
                      }
                    />
                    <Field
                      label="Tempo"
                      placeholder="e.g. 3010"
                      value={set.tempo ?? ''}
                      onChange={e => onUpdateSet(si, { tempo: e.target.value || null })}
                    />
                  </div>
                </div>
              </SwipeableRow>
            </li>
          );
        })}
      </ol>

      <div className="import-set-footer">
        <span className="import-set-count">
          {exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'} in this prescription
        </span>
        <Button
          variant="secondary"
          className="import-add-set"
          disabled={exercise.sets.length >= 24}
          onClick={onAddSet}
        >
          <Plus size={15} />
          Add set
        </Button>
      </div>
    </div>
  );
}
