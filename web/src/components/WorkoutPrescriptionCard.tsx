import { useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Dumbbell, FileText, Link2, Plus, RefreshCw, RotateCcw, Timer, Trash2, X } from 'lucide-react';
import type { Exercise, SetPrescription, TemplateExercise } from '../types';
import { restOptions } from '../lib/training';
import { demoUrlForName } from '../lib/demoLinks';
import { Button } from './ui/Button';
import { DemoLink } from './ui/DemoLink';
import { TextAreaField } from './ui/Field';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { Select } from './ui/Select';
import { getSupersetGroup, isSuperset } from '../lib/supersets';
import { SupersetModal } from './SupersetModal';
import { WorkoutPrescriptionSets } from './WorkoutPrescriptionSets';
import './Superset.css';
import './WorkoutBuilder.css';

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
  // The title already names a linked exercise, so the mapping only earns space once the two
  // disagree: a renamed slot, or one that is not in the library at all.
  const showMapping = !linked || linked.name.trim().toLowerCase() !== exercise.name.trim().toLowerCase();

  return (
    <div className={`import-exercise workout-builder-exercise-card ${exercise.sequenceGroup ? 'exercise-card-superset-active' : ''}`} key={exercise.id}>
      <div className="import-exercise-heading builder-exercise-heading">
        <div className="import-exercise-title">
          <span className="import-exercise-icon" aria-hidden="true">
            <Dumbbell size={17} />
          </span>
          <input
            name={`workout-exercise-name-${exercise.id}`}
            className="inline-input builder-exercise-name"
            aria-label={`Name for exercise ${index + 1}`}
            value={exercise.name}
            onChange={e => onUpdateExercise({ name: e.target.value, sourceName: e.target.value })}
          />
        </div>
        <div className="topbar-actions">
          <DemoLink url={exercise.demoUrl} exerciseName={exercise.name} />
          <MenuButton label={`Actions for ${exercise.name}`} variant="tertiary" portal>
            <MenuItem onClick={onOpenSwap}>
              <RefreshCw size={15} />
              Swap exercise
            </MenuItem>
            {exercise.canRestore && onRestoreExercise && (
              <MenuItem onClick={onRestoreExercise}>
                <RotateCcw size={15} />
                Restore default
              </MenuItem>
            )}
            <MenuItem destructive onClick={onRemoveExercise}>
              <Trash2 size={15} />
              Remove exercise
            </MenuItem>
          </MenuButton>
        </div>
      </div>

      {(isPaired || !exercise.exerciseId) && (
        <div className="builder-exercise-badges">
          {isPaired && (
            <Button
              variant="tertiary"
              className="superset-badge"
              title={partnerNames ? `Superset with ${partnerNames}` : 'Superset group'}
              aria-label={`Superset ${currentGroup} with ${partnerNames}`}
              onClick={() => setSupersetModalOpen(true)}
            >
              <Link2 size={12} />Superset {currentGroup}
            </Button>
          )}
          {!exercise.exerciseId && (
            <span className="tiny-label warn">
              <AlertTriangle size={12} /> Not in library
            </span>
          )}
        </div>
      )}

      <div className="import-fields builder-exercise-fields">
        {showMapping && (
          <div className="field import-library-field">
            <span>Library exercise</span>
            <Button
              variant="secondary"
              className="import-library-trigger"
              aria-label={`Library exercise for ${exercise.name}`}
              onClick={onOpenSwap}
            >
              {linked?.name ?? 'Map to library'}
            </Button>
          </div>
        )}
        <div className="field import-superset-field">
          <span>Superset</span>
          <Button
            variant="secondary"
            className={`superset-trigger ${isPaired ? 'paired' : ''}`}
            aria-label={`Superset options for ${exercise.name}`}
            onClick={() => setSupersetModalOpen(true)}
          >
            <Link2 size={14} />
            <span>{isPaired ? `${currentGroup} · ${partners.length} paired` : 'Pair'}</span>
          </Button>
        </div>
        <div className="field import-rest-field">
          <span>Rest</span>
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
        {validSubstitutions.length > 0 && (
          <div className="field import-substitutions-field">
            <span>Substitutions</span>
            <div className="substitution-chips-row" role="group" aria-label={`Substitutions for ${exercise.name}`}>
              {validSubstitutions.map(sub => (
                <span key={sub} className="substitution-chip">
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
                    onClick={() => onUpdateExercise({
                      substitutions: exercise.substitutions.filter(s => s.toLowerCase() !== sub.toLowerCase())
                    })}
                  >
                    <X size={12} />
                  </Button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <WorkoutPrescriptionSets exercise={exercise} onUpdateSet={onUpdateSet} onRemoveSet={onRemoveSet} />

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
        placeholder="Cues, setup or coaching notes for this exercise"
        onChange={e => onUpdateExercise({ note: e.target.value })}
      />

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
