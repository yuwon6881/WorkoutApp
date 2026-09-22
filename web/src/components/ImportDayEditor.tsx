import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Dumbbell, Link2, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { DraftExercise, DraftSet, DraftWorkout, Exercise } from '../types';
import { restOptions } from '../lib/training';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { RpeControl } from './ui/RpeControl';
import { Field, TextAreaField } from './ui/Field';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';
import { SwipeableRow } from './ui/SwipeableRow';
import { MenuButton, MenuItem } from './ui/MenuButton';

import { getSupersetGroup, isSuperset, pairExercises, unlinkExercise } from '../lib/supersets';
import { SupersetModal } from './SupersetModal';

import {
  type SetType,
  setTypeOptions,
  getSetType,
  getSetTypeLabel,
  cleanTechniqueNotes,
  applySetType
} from '../lib/importSetTypes';

export function DayEditor({ day, exercises, onChange, onPropagateSubstitution, onMapExerciseSlot, restorableExerciseLineIds, onRestoreExercise }: {
  day: DraftWorkout;
  exercises: Exercise[];
  onChange: (day: DraftWorkout) => Promise<void>;
  onPropagateSubstitution?: (currentName: string, replacementName: string, exerciseLineId?: string) => Promise<void>;
  onMapExerciseSlot?: (exerciseLineId: string, exerciseId: string | null) => Promise<void>;
  restorableExerciseLineIds?: string[];
  onRestoreExercise?: (exerciseLineId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(day);
  useEffect(() => setDraft(day), [day]);

  const save = (next: DraftWorkout) => {
    setDraft(next);
    void onChange(next);
  };

  const groups: DraftExercise[][] = [];
  for (const exercise of draft.exercises) {
    const prefix = exercise.sequenceGroup.trim().match(/^[A-Za-z]+/)?.[0] ?? '';
    const previous = groups.at(-1)?.[0]?.sequenceGroup.match(/^[A-Za-z]+/)?.[0] ?? '';
    if (prefix && prefix === previous) groups.at(-1)!.push(exercise);
    else groups.push([exercise]);
  }

  const handlePairExercises = (idA: string, idB: string) => {
    const updated = pairExercises(
      draft.exercises.map(e => ({ ...e, id: e.lineId })),
      idA,
      idB
    ).map(e => ({ ...e, lineId: e.id }));
    save({ ...draft, exercises: updated });
  };

  const handleUnlinkExercise = (id: string) => {
    const updated = unlinkExercise(
      draft.exercises.map(e => ({ ...e, id: e.lineId })),
      id
    ).map(e => ({ ...e, lineId: e.id }));
    save({ ...draft, exercises: updated });
  };

  const handleRemoveExercise = (lineId: string) => {
    if (draft.exercises.length <= 1) return;
    const unlinked = unlinkExercise(
      draft.exercises.map(e => ({ ...e, id: e.lineId })),
      lineId
    ).map(e => ({ ...e, lineId: e.id }));
    const remaining = unlinked.filter(e => e.lineId !== lineId);
    save({ ...draft, exercises: remaining });
  };

  return <div className="day-editor">
    <div className="day-editor-fields">
      <Field name={`day-name-${draft.lineId}`} className="day-name-field" label="Day name" value={draft.name} data-import-field="name"
        onChange={event => setDraft({ ...draft, name: event.target.value })}
        onBlur={() => void onChange(draft)} />
    </div>
    {draft.isRestDay
      ? <div className="rest-callout"><span className="tiny-label">Rest day</span><p>No exercises are scheduled for this slot.</p></div>
      : groups.map((group, groupIndex) => <div className={group.length > 1 ? 'superset-block' : ''} key={groupIndex}>
        {group.length > 1 && <div className="superset-heading">Superset {group[0].sequenceGroup.match(/^[A-Za-z]+/)?.[0] ?? ''}</div>}
        {group.map(exercise => <ExerciseEditor key={exercise.lineId} exercise={exercise} exercises={exercises} allDayExercises={draft.exercises}
          onChange={next => save({ ...draft, exercises: draft.exercises.map(item => item.lineId === next.lineId ? next : item) })}
          onRemove={() => handleRemoveExercise(exercise.lineId)}
          onPairExercises={targetLineId => handlePairExercises(exercise.lineId, targetLineId)}
          onUnlinkExercise={() => handleUnlinkExercise(exercise.lineId)}
          onPropagateSubstitution={onPropagateSubstitution}
          onMapExerciseSlot={onMapExerciseSlot}
          canRestore={restorableExerciseLineIds?.includes(exercise.lineId)}
          onRestore={onRestoreExercise ? () => onRestoreExercise(exercise.lineId) : undefined} />)}
      </div>)}
    {!draft.isRestDay && <Button variant="tertiary" className="day-add-exercise-button" onClick={() => save({ ...draft, exercises: [...draft.exercises, blankExercise()] })}>
      <Plus size={16} />Add exercise
    </Button>}
  </div>;
}

function ExerciseEditor({ exercise, exercises, allDayExercises, onChange, onRemove, onPairExercises, onUnlinkExercise, onPropagateSubstitution, onMapExerciseSlot, canRestore, onRestore }: {
  exercise: DraftExercise;
  exercises: Exercise[];
  allDayExercises: DraftExercise[];
  onChange: (exercise: DraftExercise) => void;
  onRemove?: () => void;
  onPairExercises: (targetLineId: string) => void;
  onUnlinkExercise: () => void;
  onPropagateSubstitution?: (currentName: string, replacementName: string, exerciseLineId?: string) => Promise<void>;
  onMapExerciseSlot?: (exerciseLineId: string, exerciseId: string | null) => Promise<void>;
  canRestore?: boolean;
  onRestore?: () => Promise<void>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [supersetModalOpen, setSupersetModalOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isMapping, setIsMapping] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);

  const editSet = (index: number, patch: Partial<DraftSet>) =>
    onChange({ ...exercise, sets: exercise.sets.map((set, current) => current === index ? { ...set, ...patch } : set) });

  const changeSetType = (index: number, newType: SetType) => {
    const patch = applySetType(exercise.sets[index], newType);
    let newSets = exercise.sets.map((s, i) => i === index ? { ...s, ...patch } : s);
    if (newType === 'warmup') {
      newSets = newSets.map((s, i) => i < index && !s.warmup ? { ...s, warmup: true, targetRpe: null, rpeSource: 'userEdited', notes: cleanTechniqueNotes(s.notes) } : s);
    } else {
      newSets = newSets.map((s, i) => i > index && s.warmup ? { ...s, warmup: false, targetRpe: s.targetRpe ?? 8, notes: cleanTechniqueNotes(s.notes), rpeSource: 'userEdited' } : s);
    }
    onChange({ ...exercise, sets: newSets });
  };

  const selected = exercises.find(option => option.id === exercise.exerciseId);
  const select = async (exerciseId: string | null) => {
    if (onMapExerciseSlot) {
      setIsMapping(true);
      setMappingError(null);
      setRestoreError(null);
      try {
        await onMapExerciseSlot(exercise.lineId, exerciseId);
        setPickerOpen(false);
      } catch (err) {
        setMappingError(err instanceof Error ? err.message : 'Could not map this exercise slot.');
      }
      finally { setIsMapping(false); }
      return;
    }
    const selectedExercise = exerciseId ? exercises.find(item => item.id === exerciseId) : undefined;
    onChange({ ...exercise, exerciseId, sourceName: selectedExercise?.name ?? exercise.sourceName });
    setPickerOpen(false);
  };

  const handleRestore = async () => {
    if (!onRestore || isRestoring) return;
    setIsRestoring(true);
    setRestoreError(null);
    try {
      await onRestore();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Could not restore exercise.');
    } finally {
      setIsRestoring(false);
    }
  };

  const applySubstitution = (subName: string) => {
    const matched = exercises.find(
      e => e.name.toLowerCase() === subName.toLowerCase() || e.aliases.some(a => a.toLowerCase() === subName.toLowerCase())
    );
    if (!matched) return;
    const currentName = exercise.sourceName;
    const remainingSubs = [currentName, ...exercise.substitutions.filter(s => s.toLowerCase() !== subName.toLowerCase())].slice(0, 2);
    const nextExercise: DraftExercise = {
      ...exercise,
      sourceName: matched.name,
      exerciseId: matched.id,
      substitutions: remainingSubs
    };
    if (onPropagateSubstitution) {
      void onPropagateSubstitution(currentName, matched.name, exercise.lineId);
    } else {
      onChange(nextExercise);
    }
  };

  const validSubstitutions = exercise.substitutions.filter(sub =>
    exercises.some(e => e.name.toLowerCase() === sub.toLowerCase() || e.aliases.some(a => a.toLowerCase() === sub.toLowerCase()))
  );

  const currentGroup = getSupersetGroup(exercise.sequenceGroup);
  const isPaired = isSuperset(exercise.sequenceGroup);
  const partners = allDayExercises.filter(e => e.lineId !== exercise.lineId && getSupersetGroup(e.sequenceGroup) === currentGroup);
  const partnerNames = partners.map(p => p.sourceName).join(', ');

  return <div className={`import-exercise ${exercise.sequenceGroup ? 'exercise-card-superset-active' : ''}`} data-import-exercise={exercise.lineId}>
    <div className="import-exercise-heading">
      <div className="import-exercise-title">
        <span className="import-exercise-icon" aria-hidden="true"><Dumbbell size={17} /></span>
        <div className="inline-input-wrap">
          <span className="inline-input-mirror" aria-hidden="true" data-value={exercise.sourceName || ''} />
          <input
            name={`exercise-source-name-${exercise.lineId}`}
            className="inline-input"
            aria-label="Exercise name"
            value={exercise.sourceName}
            onChange={event => onChange({ ...exercise, sourceName: event.target.value })}
          />
        </div>
        {isPaired && (
          <span
            className="superset-badge"
            title={partnerNames ? `Superset with ${partnerNames}` : 'Superset group'}
            aria-label={`Superset ${currentGroup} with ${partnerNames}`}
          >
            <Link2 size={12} />
            <span>Superset {currentGroup}</span>
            <Button
              presentation="plain"
              className="superset-unlink-chip-btn"
              aria-label={`Unlink ${exercise.sourceName} from superset`}
              title="Unlink from superset"
              onClick={e => {
                e.stopPropagation();
                onUnlinkExercise();
              }}
            >
              <X size={12} />
            </Button>
          </span>
        )}
        {!exercise.exerciseId && (
          <span className="tiny-label warn"><AlertTriangle size={12} /> Unmapped</span>
        )}
      </div>
      <div className="import-exercise-actions">
        <div className="field import-rest-field" data-import-field="rest">
          <Select
            name={`exercise-rest-${exercise.lineId}`}
            ariaLabel={`Rest timer for ${exercise.sourceName}`}
            value={exercise.restSeconds ?? 90}
            options={restOptions(exercise.restSeconds)}
            onChange={val => onChange({ ...exercise, restSeconds: Number(val) })}
          />
        </div>
        <MenuButton
          label={`Actions for ${exercise.sourceName}`}
          icon={isRestoring ? <Loader2 size={16} className="spin" /> : undefined}
        >
          <MenuItem onClick={() => setSupersetModalOpen(true)}>
            <Link2 size={14} />
            <span>{isPaired ? `Superset options (Group ${currentGroup})` : 'Pair into superset'}</span>
          </MenuItem>
          {canRestore && onRestore && (
            <MenuItem disabled={isRestoring} onClick={() => void handleRestore()}>
              <RotateCcw size={14} />
              <span>Restore default</span>
            </MenuItem>
          )}
          {onRemove && (
            <MenuItem destructive disabled={allDayExercises.length <= 1 || isRestoring} onClick={onRemove}>
              <Trash2 size={14} />
              <span>Delete exercise</span>
            </MenuItem>
          )}
        </MenuButton>
      </div>
    </div>
    {restoreError && (
      <div className="inline-error restore-error" role="alert">
        <span>{restoreError}</span>
        <Button variant="tertiary" onClick={() => void handleRestore()}>Retry</Button>
      </div>
    )}
    <div className="import-fields">
      <div className="field import-library-field">
        <Button variant="secondary" className="import-library-trigger" aria-haspopup="dialog" data-import-field="library"
          disabled={isRestoring || isMapping}
          aria-label={`Library exercise for ${exercise.sourceName}`} onClick={() => { setMappingError(null); setPickerOpen(true); }}>
          <Dumbbell size={15} />
          {selected?.name ?? (exercise.exerciseId ? 'Swap exercise' : 'Map exercise')}
        </Button>
      </div>
      <div className="field import-substitutions-field">
        <div className="substitution-chips-wrap">
          {validSubstitutions.length > 0 ? (
            <div className="substitution-chips-row" role="group" aria-label={`Substitutions for ${exercise.sourceName}`}>
              {validSubstitutions.map((sub, sIdx) => (
                <span key={sIdx} className="substitution-chip">
                  <Button
                    presentation="plain"
                    className="substitution-swap-btn"
                    title={`Swap ${exercise.sourceName} for ${sub} across this block`}
                    aria-label={`Swap ${exercise.sourceName} for ${sub} across this block`}
                    disabled={isRestoring}
                    onClick={() => applySubstitution(sub)}
                  >
                    <ArrowLeftRight size={13} className="swap-icon" />
                    <span>{sub}</span>
                  </Button>
                  <Button
                    presentation="plain"
                    className="chip-remove-btn"
                    title={`Remove substitution ${sub}`}
                    aria-label={`Remove substitution ${sub}`}
                    disabled={isRestoring}
                    onClick={() => {
                      onChange({
                        ...exercise,
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
    <TextAreaField name={`exercise-notes-${exercise.lineId}`} className="import-exercise-notes" label="Description"
      value={exercise.notes ?? ''} placeholder="Cues, tempo or coaching notes"
      onChange={event => onChange({ ...exercise, notes: event.target.value })} />

    <ol className="import-sets" aria-label={`Set prescriptions for ${exercise.sourceName}`} data-import-field="sets">
      {exercise.sets.map((set, index) => {
        const setDisplayNumber = exercise.sets
          .slice(0, index + 1)
          .filter(s => !!s.warmup === !!set.warmup).length;
        const setTypeLabel = getSetTypeLabel(set);
        const remove = <Button variant="destructive" className="import-set-remove" aria-label={`Remove ${set.warmup ? 'warm-up' : 'set'} ${setDisplayNumber}`} onClick={() => onChange({ ...exercise, sets: exercise.sets.filter((_, current) => current !== index) })}>
          <Trash2 size={15} /><span>Delete</span>
        </Button>;
        return <li className={`import-set ${set.warmup ? 'warmup-row' : ''}`} key={index}>
          <SwipeableRow className="import-set-swipe-row" actions={remove} desktopActions={remove} actionsWidth={88} actionsLabel={`Actions for ${set.warmup ? 'warm-up' : 'set'} ${setDisplayNumber}`}>
            <div className="import-set-content" data-import-set-index={index}>
              <div className="import-set-heading">
                <span className={`set-number set-badge-${getSetType(set)}`}>
                  <span className="set-number-label">{setTypeLabel}</span>
                  <strong>{setDisplayNumber}</strong>
                </span>
                <label className="field set-type-field">
                  <span>Type</span>
                  <Select
                    name={`set-type-${exercise.lineId}-${index}`}
                    ariaLabel={`Set ${setDisplayNumber} type for ${exercise.sourceName}`}
                    value={getSetType(set)}
                    options={setTypeOptions}
                    onChange={val => changeSetType(index, val as SetType)}
                  />
                </label>
              </div>
              <div className="import-set-fields">
                <Field name={`rep-min-${exercise.lineId}-${index}`} label="Min reps" inputMode="numeric" type="number" value={set.repMin} data-import-field="repMin" data-import-set-index={index} onChange={event => editSet(index, { repMin: Number(event.target.value), repsText: null, repsSource: 'userEdited' })} />
                <Field name={`rep-max-${exercise.lineId}-${index}`} label="Max reps" inputMode="numeric" type="number" value={set.repMax} data-import-field="repMax" data-import-set-index={index} onChange={event => editSet(index, { repMax: Number(event.target.value), repsText: null, repsSource: 'userEdited' })} />
                <div className="field rpe-field" data-import-field="targetRpe" data-import-set-index={index}>
                  <span>Target RIR</span>
                  <RpeControl
                    name={`target-rir-${exercise.lineId}-${index}`}
                    ariaLabel={`Target RIR for ${exercise.sourceName} set ${setDisplayNumber}`}
                    value={
                      set.rir === '5+' || (set.rir && Number(set.rir) >= 5)
                        ? 5
                        : set.rir && Number.isFinite(Number(set.rir))
                        ? Math.round(Number(set.rir))
                        : set.targetRpe !== null
                        ? Math.round(10 - set.targetRpe)
                        : null
                    }
                    disabled={set.warmup}
                    onChange={value => editSet(index, {
                      targetRpe: value !== null ? (value >= 5 ? 6 : 10 - value) : null,
                      rir: value !== null ? (value >= 5 ? '5+' : String(value)) : null,
                      rpeSource: 'userEdited'
                    })}
                  />
                </div>
              </div>
            </div>
          </SwipeableRow>
        </li>;
      })}
    </ol>
    <div className="import-set-footer">
      <Button variant="secondary" className="import-add-set" disabled={exercise.sets.length >= 24} onClick={() => {
        const previous = exercise.sets.at(-1) ?? blankSet();
        onChange({ ...exercise, sets: [...exercise.sets, { ...previous, warmup: false, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }] });
      }}>
        <Plus size={15} />Add another set
      </Button>
    </div>

    {pickerOpen && <Modal title={`Choose exercise for ${exercise.sourceName.length > 32 ? `${exercise.sourceName.slice(0, 30)}…` : exercise.sourceName}`} wide onClose={() => setPickerOpen(false)}>
      <div className="modal-body import-library-picker">
        <p>Search the catalog by exercise, equipment, muscle, movement pattern, or alias.</p>
        {mappingError && <div className="inline-error" role="alert">{mappingError}</div>}
        <ExerciseLibrary
          exercises={exercises}
          action={exercise.exerciseId ? 'swap' : 'map'}
          currentExerciseId={exercise.exerciseId}
          preferredNames={exercise.substitutions}
          disabled={isMapping}
          onSelect={id => select(id)}
        />
      </div>
      <div className="modal-actions">
        <Button variant="primary" disabled={isMapping} onClick={() => setPickerOpen(false)}>Done</Button>
      </div>
    </Modal>}

    {supersetModalOpen && (
      <SupersetModal
        open={supersetModalOpen}
        onClose={() => setSupersetModalOpen(false)}
        currentExerciseId={exercise.lineId}
        currentExerciseName={exercise.sourceName}
        currentSequenceGroup={exercise.sequenceGroup}
        candidates={allDayExercises.map(e => ({
          id: e.lineId,
          name: e.sourceName,
          sequenceGroup: e.sequenceGroup
        }))}
        onPair={targetId => onPairExercises(targetId)}
        onUnlink={onUnlinkExercise}
      />
    )}
  </div>;
}

function blankExercise(): DraftExercise {
  return { lineId: crypto.randomUUID(), sourceName: 'New exercise', exerciseId: null, restSeconds: 90, notes: null, sequenceGroup: '', substitutions: [], sets: [blankSet()] };
}

function blankSet(): DraftSet {
  return { repMin: 8, repMax: 12, targetRpe: 8, restSeconds: null, tempo: null, loadText: null, notes: null, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited', repsText: null, restText: null, rir: null, warmup: false };
}
