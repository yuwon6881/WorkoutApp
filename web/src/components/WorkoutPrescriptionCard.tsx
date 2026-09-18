import { useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Dumbbell, FileText, Link2, Plus, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import type { Exercise, SetPrescription, TemplateExercise } from '../types';
import { rpeOptions } from '../lib/training';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { Select } from './ui/Select';
import { SwipeableRow } from './ui/SwipeableRow';

const supersetOptions = [
  { value: '', label: 'None (Standalone)' },
  { value: 'A', label: 'Superset A' },
  { value: 'B', label: 'Superset B' },
  { value: 'C', label: 'Superset C' },
  { value: 'D', label: 'Superset D' }
];

export function WorkoutPrescriptionCard({
  exercise,
  index,
  exercises,
  onUpdateExercise,
  onRemoveExercise,
  onOpenSwap,
  onAddSet,
  onUpdateSet,
  onRemoveSet,
  onRestoreExercise
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
  onRestoreExercise?: () => void;
}) {
  const [newSub, setNewSub] = useState('');
  const linked = exercises.find(item => item.id === exercise.exerciseId);

  const applySubstitution = (subName: string) => {
    const oldName = exercise.name;
    const matched = exercises.find(e => e.name.toLowerCase() === subName.toLowerCase());
    const remainingSubs = [oldName, ...exercise.substitutions.filter(s => s.toLowerCase() !== subName.toLowerCase())].slice(0, 2);
    onUpdateExercise({
      name: subName,
      sourceName: subName,
      exerciseId: matched ? matched.id : exercise.exerciseId,
      substitutions: remainingSubs
    });
  };

  const handleAddSub = () => {
    const clean = newSub.trim();
    if (!clean || exercise.substitutions.some(s => s.toLowerCase() === clean.toLowerCase())) {
      setNewSub('');
      return;
    }
    onUpdateExercise({ substitutions: [...exercise.substitutions, clean].slice(0, 2) });
    setNewSub('');
  };

  const currentGroupLetter = exercise.sequenceGroup?.trim().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
  const handleSupersetChange = (letter: string) => {
    if (!letter) {
      onUpdateExercise({ sequenceGroup: '' });
      return;
    }
    onUpdateExercise({ sequenceGroup: `${letter}1` });
  };

  return (
    <div className={`import-exercise workout-builder-exercise-card ${exercise.sequenceGroup ? 'exercise-card-superset-active' : ''}`} key={exercise.id}>
      <div className="import-exercise-heading">
        <div className="import-exercise-title">
          <span className="import-exercise-icon" aria-hidden="true">
            <Dumbbell size={17} />
          </span>
          <input
            name={`workout-exercise-name-${exercise.id}`}
            className="inline-input"
            aria-label={`Name for exercise ${index + 1}`}
            value={exercise.name}
            onChange={e => onUpdateExercise({ name: e.target.value, sourceName: e.target.value })}
          />
        </div>
        <div className="topbar-actions">
          {exercise.sequenceGroup && (
            <span className="superset-badge">
              <Link2 size={12} />Superset {exercise.sequenceGroup}
            </span>
          )}
          {!exercise.exerciseId && (
            <span className="tiny-label warn">
              <AlertTriangle size={12} /> Unmapped
            </span>
          )}
          {exercise.canRestore && onRestoreExercise && (
            <Button variant="tertiary" aria-label={`Restore default for ${exercise.name}`} onClick={onRestoreExercise}>
              <RotateCcw size={14} />
              Restore default
            </Button>
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
            {linked?.name ?? (exercise.exerciseId ? 'Swap exercise' : 'Map to library')}
          </Button>
        </div>
        <div className="field import-superset-field">
          <span>Superset group</span>
          <div className="superset-control-wrap">
            <Select
              name={`workout-superset-${exercise.id}`}
              ariaLabel={`Superset group for ${exercise.name}`}
              value={currentGroupLetter}
              options={supersetOptions}
              onChange={handleSupersetChange}
            />
          </div>
        </div>
        <div className="field import-substitutions-field">
          <span>Substitutions</span>
          <div className="substitution-chips-wrap">
            {exercise.substitutions.length > 0 && (
              <div className="substitution-chips-row" role="group" aria-label={`Substitutions for ${exercise.name}`}>
                {exercise.substitutions.map((sub, sIdx) => (
                  <div
                    key={sIdx}
                    className="substitution-chip"
                    title={`Swap ${exercise.name} with ${sub}`}
                    onClick={() => applySubstitution(sub)}
                  >
                    <ArrowLeftRight size={13} className="swap-icon" />
                    <span>{sub}</span>
                    <Button
                      presentation="plain"
                      className="chip-remove-btn"
                      aria-label={`Remove substitution ${sub}`}
                      onClick={e => {
                        e.stopPropagation();
                        onUpdateExercise({
                          substitutions: exercise.substitutions.filter((_, idx) => idx !== sIdx)
                        });
                      }}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {exercise.substitutions.length < 2 && (
              <div className="substitution-add-form">
                <input
                  name={`new-sub-${exercise.id}`}
                  className="substitution-add-input"
                  placeholder="Add alternate exercise…"
                  value={newSub}
                  onChange={e => setNewSub(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSub();
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  className="substitution-add-btn"
                  disabled={!newSub.trim()}
                  onClick={handleAddSub}
                  aria-label="Add alternate exercise"
                >
                  <Plus size={13} />Add
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <TextAreaField
        name={`workout-exercise-notes-${exercise.id}`}
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
                        name={`workout-warmup-${exercise.id}-${si}`}
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
                      name={`workout-rep-min-${exercise.id}-${si}`}
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
                      name={`workout-rep-max-${exercise.id}-${si}`}
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
                      name={`workout-rest-${exercise.id}-${si}`}
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
                      name={`workout-tempo-${exercise.id}-${si}`}
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
