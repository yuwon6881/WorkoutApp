import { useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Dumbbell, FileText, Link2, Plus, RefreshCw, RotateCcw, Timer, Trash2, X } from 'lucide-react';
import type { Exercise, SetPrescription, TemplateExercise } from '../types';
import { restOptions } from '../lib/training';
import { demoUrlForName } from '../lib/demoLinks';
import { Button } from './ui/Button';
import { DemoLink } from './ui/DemoLink';
import { Field, TextAreaField } from './ui/Field';
import { Select } from './ui/Select';
import { RpeControl } from './ui/RpeControl';
import { WarmupRirNote } from './ui/WarmupRirNote';
import { RepPrescriptionControl } from './ui/RepPrescriptionControl';
import { SwipeableRow } from './ui/SwipeableRow';

import { getSupersetGroup, isSuperset } from '../lib/supersets';
import { SupersetModal } from './SupersetModal';

export function WorkoutPrescriptionCard({
  exercise,
  index,
  exercises,
  allExercises,
  onUpdateExercise,
  onRemoveExercise,
  onOpenSwap,
  onPairExercises,
  onUnlinkExercise,
  onAddSet,
  onUpdateSet,
  onRemoveSet,
  onRestoreExercise
}: {
  exercise: TemplateExercise;
  index: number;
  exercises: Exercise[];
  allExercises?: TemplateExercise[];
  onUpdateExercise: (patch: Partial<TemplateExercise>) => void;
  onRemoveExercise: () => void;
  onOpenSwap: () => void;
  onPairExercises?: (targetExerciseId: string) => void;
  onUnlinkExercise?: () => void;
  onAddSet: () => void;
  onUpdateSet: (setIndex: number, patch: Partial<SetPrescription>) => void;
  onRemoveSet: (setIndex: number) => void;
  onRestoreExercise?: () => void;
}) {
  const [supersetModalOpen, setSupersetModalOpen] = useState(false);
  const linked = exercises.find(item => item.id === exercise.exerciseId);

  const applySubstitution = (subName: string) => {
    const matched = exercises.find(
      e => e.name.toLowerCase() === subName.toLowerCase() || e.aliases.some(a => a.toLowerCase() === subName.toLowerCase())
    );
    if (!matched) return;
    const oldLibrary = exercises.find(e => e.id === exercise.exerciseId);
    const oldName = oldLibrary?.name || exercise.name;
    const remainingSubs = [oldName, ...exercise.substitutions.filter(s => s.toLowerCase() !== subName.toLowerCase())].slice(0, 2);
    onUpdateExercise({
      name: matched.name,
      sourceName: matched.name,
      exerciseId: matched.id,
      loadModel: matched.loadModel || exercise.loadModel,
      substitutions: remainingSubs,
      demoUrl: demoUrlForName(exercise.demoLinks, matched.name)
    });
  };

  const validSubstitutions = exercise.substitutions.filter(sub =>
    exercises.some(e => e.name.toLowerCase() === sub.toLowerCase() || e.aliases.some(a => a.toLowerCase() === sub.toLowerCase()))
  );

  const currentGroup = getSupersetGroup(exercise.sequenceGroup);
  const isPaired = isSuperset(exercise.sequenceGroup);
  const partners = (allExercises ?? []).filter(
    e => e.id !== exercise.id && getSupersetGroup(e.sequenceGroup) === currentGroup
  );
  const partnerNames = partners.map(p => p.name).join(', ');

  return (
    <div className={`import-exercise workout-builder-exercise-card ${exercise.sequenceGroup ? 'exercise-card-superset-active' : ''}`} key={exercise.id}>
      <div className="import-exercise-heading">
        <div className="import-exercise-title">
          <span className="import-exercise-icon" aria-hidden="true">
            <Dumbbell size={17} />
          </span>
          <div className="inline-input-wrap">
            <span className="inline-input-mirror" aria-hidden="true" data-value={exercise.name || ''} />
            <input
              name={`workout-exercise-name-${exercise.id}`}
              className="inline-input"
              aria-label={`Name for exercise ${index + 1}`}
              value={exercise.name}
              onChange={e => onUpdateExercise({ name: e.target.value, sourceName: e.target.value })}
            />
          </div>
          {isPaired && (
            <span
              className="superset-badge"
              role="button"
              tabIndex={0}
              title={partnerNames ? `Superset with ${partnerNames}` : 'Superset group'}
              aria-label={`Superset ${currentGroup} with ${partnerNames}`}
              onClick={() => setSupersetModalOpen(true)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSupersetModalOpen(true); }}
            >
              <Link2 size={12} />Superset {currentGroup}
            </span>
          )}
        </div>
        <div className="topbar-actions">
          {!exercise.exerciseId && (
            <span className="tiny-label warn">
              <AlertTriangle size={12} /> Unmapped
            </span>
          )}
          <DemoLink url={exercise.demoUrl} exerciseName={exercise.name} />
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
          <span>Superset</span>
          <Button
            variant="secondary"
            className={`superset-trigger ${isPaired ? 'paired' : ''}`}
            aria-label={`Superset options for ${exercise.name}`}
            onClick={() => setSupersetModalOpen(true)}
          >
            <Link2 size={14} />
            <span>{isPaired ? `Superset ${currentGroup} · ${partners.length} paired` : 'Pair into superset'}</span>
          </Button>
        </div>
        <div className="field import-rest-field">
          <span>Rest timer</span>
          <Select
            name={`workout-exercise-rest-${exercise.id}`}
            ariaLabel={`Rest timer for ${exercise.name}`}
            title="Rest timer"
            icon={<Timer size={14} className="rest-timer-icon" />}
            value={exercise.restSeconds ?? 90}
            options={restOptions(exercise.restSeconds)}
            onChange={val => onUpdateExercise({ restSeconds: Number(val) })}
          />
        </div>
        <div className="field import-substitutions-field">
          <span>Substitutions</span>
          <div className="substitution-chips-wrap">
            {validSubstitutions.length > 0 ? (
              <div className="substitution-chips-row" role="group" aria-label={`Substitutions for ${exercise.name}`}>
                {validSubstitutions.map((sub, sIdx) => (
                  <span
                    key={sIdx}
                    className="substitution-chip"
                  >
                    <Button presentation="plain" className="substitution-swap-btn"
                      aria-label={`Swap ${exercise.name} for ${sub}`}
                      onClick={() => applySubstitution(sub)}>
                      <ArrowLeftRight size={13} className="swap-icon" />
                      <span>{sub}</span>
                    </Button>
                    <Button
                      presentation="plain"
                      className="chip-remove-btn"
                      aria-label={`Remove substitution ${sub}`}
                      onClick={() => {
                        onUpdateExercise({
                          substitutions: exercise.substitutions.filter(s => s.toLowerCase() !== sub.toLowerCase())
                        });
                      }}
                    >
                      <X size={12} />
                    </Button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="muted small-copy substitution-empty-state">No substitutions available.</span>
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
                            targetRpe: e.target.checked ? null : set.targetRpe ?? 8,
                            rir: e.target.checked ? null : set.rir
                          })
                        }
                      />
                      Warm-up
                    </label>
                  </div>
                  <div className="import-set-fields">
                    <RepPrescriptionControl
                      repMin={set.repMin}
                      repMax={set.repMax}
                      nameMin={`workout-rep-min-${exercise.id}-${si}`}
                      nameMax={`workout-rep-max-${exercise.id}-${si}`}
                      nameSingle={`workout-rep-${exercise.id}-${si}`}
                      onChange={({ repMin, repMax }) =>
                        onUpdateSet(si, { repMin, repMax })
                      }
                    />
                    {set.warmup ? <WarmupRirNote /> : <div className="field rpe-field">
                      <span>Target RIR</span>
                      <RpeControl
                        name={`target-rir-${exercise.id}-${si}`}
                        ariaLabel={`${exercise.name} set ${si + 1} target RIR`}
                        value={
                          set.rir === '5+' || (set.rir && Number(set.rir) >= 5)
                            ? 5
                            : set.rir && Number.isFinite(Number(set.rir))
                            ? Math.round(Number(set.rir))
                            : set.targetRpe !== null
                            ? Math.round(10 - set.targetRpe)
                            : null
                        }
                        onChange={val =>
                          onUpdateSet(si, {
                            targetRpe: val !== null ? (val >= 5 ? 6 : 10 - val) : null,
                            rir: val !== null ? (val >= 5 ? '5+' : String(val)) : null
                          })
                        }
                      />
                    </div>}
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

      <SupersetModal
        open={supersetModalOpen}
        onClose={() => setSupersetModalOpen(false)}
        currentExerciseId={exercise.id}
        currentExerciseName={exercise.name}
        currentSequenceGroup={exercise.sequenceGroup}
        candidates={(allExercises ?? []).map(e => ({
          id: e.id,
          name: e.name,
          sequenceGroup: e.sequenceGroup
        }))}
        onPair={targetId => onPairExercises?.(targetId)}
        onUnlink={() => onUnlinkExercise?.()}
      />
    </div>
  );
}
