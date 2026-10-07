import { useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Check, Dumbbell, Link2, Loader2, Plus, RotateCcw, Timer, Trash2, X } from 'lucide-react';
import type { CustomExerciseCreated, DraftExercise, DraftSet, Exercise } from '../types';
import { restOptions } from '../lib/training';
import { demoUrlForName } from '../lib/demoLinks';
import { Button } from './ui/Button';
import { DemoLink } from './ui/DemoLink';
import { Select } from './ui/Select';
import { RpeControl } from './ui/RpeControl';
import { WarmupRirNote } from './ui/WarmupRirNote';
import { SetTypeSelect } from './ui/SetTypeSelect';
import { RepModeToggle, RepPrescriptionControl } from './ui/RepPrescriptionControl';
import { TextAreaField } from './ui/Field';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';
import { CustomExerciseModal } from './CustomExerciseModal';
import { SwipeableRow } from './ui/SwipeableRow';
import { toggleRepMode, usesRepRange } from '../lib/repMode';
import './SetPrescriptionGrid.css';
import './ProgramBuilder.css';
import './PrescriptionCardLayout.css';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { getSupersetGroup, isSuperset } from '../lib/supersets';
import { SupersetModal } from './SupersetModal';
import { useTrackRir } from '../lib/trackRir';
import type { ExerciseEditing } from '../lib/exerciseEditScope';
import { ExerciseScopeModal } from './ExerciseScopeModal';
import { useExerciseDraft } from './useExerciseDraft';
import { useExerciseSave } from './useExerciseSave';
import {
  type SetType,
  getSetType,
  cleanTechniqueNotes,
  applySetType,
  hasOpenReps
} from '../lib/importSetTypes';

export function blankSet(): DraftSet {
  return { repMin: 8, repMax: 12, targetRpe: 8, restSeconds: null, tempo: null, loadText: null, notes: null, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited', repsText: null, restText: null, rir: null, warmup: false };
}

export function blankExercise(): DraftExercise {
  return { lineId: crypto.randomUUID(), sourceName: 'New exercise', exerciseId: null, restSeconds: 90, notes: null, sequenceGroup: '', substitutions: [], sets: [blankSet()] };
}

export function ExerciseEditor({ exercise: saved, exercises, allDayExercises, rememberedRepWidths, editing, onRemove, onPairExercises, onUnlinkExercise, onCustomExerciseCreated, canRestore, onRestore }: {
  /// The exercise as last saved. Edits are held here until Save, then committed with a scope.
  exercise: DraftExercise;
  exercises: Exercise[];
  allDayExercises: DraftExercise[];
  rememberedRepWidths: Map<number, number>;
  editing: ExerciseEditing;
  onRemove?: () => void;
  onPairExercises: (targetLineId: string) => void;
  onUnlinkExercise: () => void;
  onCustomExerciseCreated?: () => Promise<void>;
  canRestore?: boolean;
  onRestore?: () => Promise<void>;
}) {
  const trackRir = useTrackRir();
  const { exercise, setExercise: onChange, dirty, discard, acknowledgeSave } = useExerciseDraft(saved, editing.unsaved);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [supersetModalOpen, setSupersetModalOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const { isSaving, saveError, setSaveError, scopeRequest, setScopeRequest, requestSave, commit } = useExerciseSave(saved, exercise, editing, () => acknowledgeSave(exercise));
  const editSet = (index: number, patch: Partial<DraftSet>) =>
    onChange({ ...exercise, sets: exercise.sets.map((set, current) => current === index ? { ...set, ...patch } : set) });

  const removeSet = (index: number) => {
    const shiftedWidths = [...rememberedRepWidths.entries()]
      .filter(([setIndex]) => setIndex !== index)
      .map(([setIndex, width]) => [setIndex > index ? setIndex - 1 : setIndex, width] as const);
    rememberedRepWidths.clear();
    for (const [setIndex, width] of shiftedWidths) rememberedRepWidths.set(setIndex, width);
    onChange({ ...exercise, sets: exercise.sets.filter((_, current) => current !== index) });
  };

  const changeSetType = (index: number, newType: SetType) => {
    const patch = applySetType(exercise.sets[index], newType);
    let newSets = exercise.sets.map((s, i) => i === index ? { ...s, ...patch } : s);
    if (newType === 'warmup') {
      newSets = newSets.map((s, i) => i < index && !s.warmup ? { ...s, warmup: true, targetRpe: null, rir: null, rpeSource: 'userEdited', notes: cleanTechniqueNotes(s.notes) } : s);
    } else {
      newSets = newSets.map((s, i) => i > index && s.warmup ? { ...s, warmup: false, targetRpe: s.targetRpe ?? 8, notes: cleanTechniqueNotes(s.notes), rpeSource: 'userEdited' } : s);
    }
    onChange({ ...exercise, sets: newSets });
  };

  const selected = exercises.find(option => option.id === exercise.exerciseId)
    || (exercise.sourceName ? exercises.find(option => option.name.toLowerCase() === exercise.sourceName.toLowerCase() || option.aliases.some(a => a.toLowerCase() === exercise.sourceName.toLowerCase())) : undefined);
  const repRange = usesRepRange(exercise.sets.filter(set => !hasOpenReps(set)));
  const select = (exerciseId: string | null) => {
    const selectedExercise = exerciseId ? exercises.find(item => item.id === exerciseId) : undefined;
    if (editing.keepWrittenName) {
      onChange({ ...exercise, exerciseId });
    } else {
      const sourceName = selectedExercise?.name ?? exercise.sourceName;
      onChange({ ...exercise, exerciseId, sourceName, demoUrl: demoUrlForName(exercise.demoLinks, sourceName) });
    }
    setPickerOpen(false);
  };

  // Edits are held in this card until Save, so the default is reached by restoring the saved row
  // (when it differs) and dropping the held edits; otherwise they would keep masking the restore.
  const savedRestorable = Boolean(canRestore && onRestore);
  const restoreAvailable = savedRestorable || dirty;
  const handleRestore = async () => {
    if (isRestoring || isSaving) return;
    if (!savedRestorable || !onRestore) {
      discard();
      return;
    }
    setIsRestoring(true);
    setRestoreError(null);
    try {
      await onRestore();
      discard();
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
    const currentLibraryName = exercises.find(e => e.id === exercise.exerciseId)?.name ?? exercise.sourceName;
    const remainingSubs = [currentLibraryName, ...exercise.substitutions.filter(s => s.toLowerCase() !== subName.toLowerCase())].slice(0, 2);
    const nextExercise: DraftExercise = {
      ...exercise,
      sourceName: matched.name,
      exerciseId: matched.id,
      substitutions: remainingSubs,
      demoUrl: demoUrlForName(exercise.demoLinks, matched.name)
    };
    onChange(nextExercise);
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
            autoCorrect="off"
            spellCheck={false}
            value={exercise.sourceName}
            onChange={event => onChange({ ...exercise, sourceName: event.target.value })}
          />
        </div>
      </div>
      <div className="prescription-context-row">
        {isPaired && (
          <span
            className="chip-group active prescription-superset-chip"
            title={partnerNames ? `Superset with ${partnerNames}` : 'Superset group'}
            aria-label={`Superset ${currentGroup} with ${partnerNames}`}
          >
            <span className="filter-chip active prescription-superset-label">
              <Link2 size={12} />Pair {currentGroup}
            </span>
            <Button
              presentation="plain"
              className="chip-icon-btn"
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
        <div className="import-exercise-actions">
          <DemoLink url={exercise.demoUrl} exerciseName={exercise.sourceName} />
          <div className="field import-rest-field" data-import-field="rest">
            <Select
              name={`exercise-rest-${exercise.lineId}`}
              ariaLabel={`Rest timer for ${exercise.sourceName}`}
              title="Rest timer"
              icon={<Timer size={14} className="rest-timer-icon" />}
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
            {restoreAvailable && (
              <MenuItem disabled={isRestoring || isSaving} onClick={() => void handleRestore()}>
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
    </div>
    {restoreError && (
      <div className="inline-error restore-error" role="alert">
        <span>{restoreError}</span>
        <Button variant="tertiary" onClick={() => void handleRestore()}>Retry</Button>
      </div>
    )}
    <div className="import-exercise-body">
      <div className="import-exercise-col import-exercise-details-col">
        <div className="import-fields">
          <div className="import-library-row">
            <div className="field import-library-field">
              <Button variant="secondary" className="import-library-trigger" aria-haspopup="dialog" data-import-field="library"
                disabled={isRestoring || isSaving}
                aria-label={`Library exercise for ${exercise.sourceName}`} onClick={() => setPickerOpen(true)}>
                <Dumbbell size={15} />
                <span className="import-library-name">
                  {selected?.name ?? (exercise.exerciseId ? 'Swap exercise' : 'Map exercise')}
                </span>
              </Button>
            </div>
            {/* The warning sits with the control that resolves it, not among the timing actions. */}
            {!exercise.exerciseId && (
              <span className="tiny-label warn import-unmapped-note"><AlertTriangle size={12} aria-hidden="true" />Not linked to the library</span>
            )}
            {selected && (
              <div className="import-exercise-muscles" aria-label={`Target muscles: ${[selected.muscle, ...(selected.secondaryMuscles ?? [])].filter(Boolean).join(', ')}`}>
                <span className="pill pill-accent">{selected.muscle || 'Full body'}</span>
                {selected.secondaryMuscles && selected.secondaryMuscles.length > 0 && (
                  <span className="pill pill-muted">{selected.secondaryMuscles[0]}</span>
                )}
                {selected.secondaryMuscles && selected.secondaryMuscles.length > 1 && (
                  <span className="pill pill-muted pill-overflow" title={selected.secondaryMuscles.slice(1).join(', ')}>
                    +{selected.secondaryMuscles.length - 1}
                  </span>
                )}
              </div>
            )}
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
          autoGrow maxLength={1000}
          onChange={event => onChange({ ...exercise, notes: event.target.value })} />
      </div>

      <div className="import-exercise-col import-exercise-sets-col">
        <div className={`set-grid-wrap set-grid-typed ${repRange ? 'set-grid-range' : 'set-grid-exact'}`}>
        <div className="set-grid-head">
          <span className="set-grid-head-reps">
            <span aria-hidden="true">Reps</span>
            <RepModeToggle
              range={repRange}
              label={`Rep target for ${exercise.sourceName}`}
              onChange={range => onChange({
                ...exercise,
                sets: toggleRepMode(exercise.sets, range, rememberedRepWidths)
                  .map(set => hasOpenReps(set)
                    ? set
                    : { ...set, repsText: null, repsSource: 'userEdited' })
              })}
            />
          </span>
          {trackRir && <span className="set-grid-head-rir" aria-hidden="true">RIR</span>}
        </div>
        <ol className="import-sets set-grid-list" aria-label={`Set prescriptions for ${exercise.sourceName}`} data-import-field="sets">
          {exercise.sets.map((set, index) => {
            const setDisplayNumber = exercise.sets
              .slice(0, index + 1)
              .filter(s => !!s.warmup === !!set.warmup).length;
            const remove = <Button variant="destructive" className="import-set-remove" aria-label={`Remove ${set.warmup ? 'warm-up' : 'set'} ${setDisplayNumber}`} onClick={() => removeSet(index)}>
              <Trash2 size={15} /><span className="sr-only">Delete</span>
            </Button>;
            return <li className={`import-set ${set.warmup ? 'warmup-row' : ''}`} key={index}>
              <SwipeableRow className="import-set-swipe-row" actions={remove} desktopActions={remove} actionsWidth={72} peek={index === 0} actionsLabel={`Actions for ${set.warmup ? 'warm-up' : 'set'} ${setDisplayNumber}`}>
                <div className="import-set-content set-grid-row" data-import-set-index={index}>
                  <div className="import-set-heading">
                    <SetTypeSelect
                      name={`set-type-${exercise.lineId}-${index}`}
                      ariaLabel={`Set ${setDisplayNumber} type for ${exercise.sourceName}`}
                      type={getSetType(set)}
                      number={setDisplayNumber}
                      onChange={type => changeSetType(index, type)}
                    />
                  </div>
                  <div className="import-set-fields">
                    <RepPrescriptionControl
                      repMin={set.repMin}
                      repMax={set.repMax}
                      range={repRange}
                      nameMin={`rep-min-${exercise.lineId}-${index}`}
                      nameMax={`rep-max-${exercise.lineId}-${index}`}
                      nameSingle={`rep-${exercise.lineId}-${index}`}
                      dataImportIndex={index}
                      labelPrefix={`${exercise.sourceName} ${set.warmup ? 'warm-up' : 'set'} ${setDisplayNumber}`}
                      openReps={hasOpenReps(set)}
                      onChange={({ repMin, repMax }) =>
                        editSet(index, { repMin, repMax, repsText: null, repsSource: 'userEdited' })
                      }
                    />
                    {!trackRir ? null : set.warmup ? <WarmupRirNote dataImportIndex={index} /> : <div className="field rpe-field" data-import-field="targetRpe" data-import-set-index={index}>
                      <span>RIR</span>
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
                        onChange={value => editSet(index, {
                          targetRpe: value !== null ? (value >= 5 ? 6 : 10 - value) : null,
                          rir: value !== null ? (value >= 5 ? '5+' : String(value)) : null,
                          rpeSource: 'userEdited'
                        })}
                      />
                    </div>}
                  </div>
                </div>
              </SwipeableRow>
            </li>;
          })}
        </ol>
        </div>
        <div className="import-set-footer">
          <Button variant="secondary" className="import-add-set" disabled={exercise.sets.length >= 24} onClick={() => {
            const previous = exercise.sets.at(-1) ?? blankSet();
            const previousWidth = rememberedRepWidths.get(exercise.sets.length - 1);
            if (previousWidth !== undefined && previousWidth > 0) rememberedRepWidths.set(exercise.sets.length, previousWidth);
            onChange({ ...exercise, sets: [...exercise.sets, { ...previous, warmup: false,
              targetRpe: previous.targetRpe ?? 8, rir: previous.warmup ? null : previous.rir,
              repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }] });
          }}>
            <Plus size={15} />Add another set
          </Button>
        </div>
      </div>
    </div>

    {(dirty || saveError) && !scopeRequest && (
      <div className="import-exercise-save-bar" data-import-save-bar={exercise.lineId}>
        <span className="import-exercise-save-state" role="status">
          {saveError ?? 'Unsaved changes'}
        </span>
        <Button variant="tertiary" disabled={isSaving} onClick={() => { setSaveError(null); discard(); }}>Cancel</Button>
        <Button variant="primary" disabled={isSaving || !dirty} onClick={requestSave}>
          {isSaving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}Save changes
        </Button>
      </div>
    )}

    {scopeRequest && <ExerciseScopeModal
      exerciseName={saved.sourceName}
      changes={scopeRequest.changes}
      counts={scopeRequest.counts}
      busy={isSaving}
      error={saveError}
      onConfirm={scope => void commit(scope)}
      onCancel={() => setScopeRequest(null)}
    />}

    {pickerOpen && <Modal title={`Choose exercise for ${exercise.sourceName.length > 32 ? `${exercise.sourceName.slice(0, 30)}…` : exercise.sourceName}`} wide onClose={() => setPickerOpen(false)}>
      <div className="modal-body import-library-picker">
        <p>Search the catalog by exercise, equipment, muscle, movement pattern, or alias.</p>
        <ExerciseLibrary
          exercises={exercises}
          action={exercise.exerciseId ? 'swap' : 'map'}
          currentExerciseId={exercise.exerciseId}
          preferredNames={exercise.substitutions}
          onSelect={id => select(id)}
        />
      </div>
      <div className="modal-actions">
        <Button variant="secondary" onClick={() => setCustomOpen(true)}>
          <Plus size={15} />Create custom exercise
        </Button>
        <Button variant="primary" onClick={() => setPickerOpen(false)}>Done</Button>
      </div>
    </Modal>}

    {customOpen && (
      <CustomExerciseModal
        initialName={/\b(?:weak\s+point|your\s+choice|pick\s+one|choose\s+one)\b|^N\/?A$/i.test(exercise.sourceName) ? '' : exercise.sourceName}
        onClose={() => setCustomOpen(false)}
        onExerciseCreated={async (newExercise: CustomExerciseCreated) => {
          // Reload the account-owned library before mapping so the exercise picker and mapping
          // endpoint both observe the server-created row. A failed map is retried by the modal
          // with the same ID; it never submits a second create request.
          await onCustomExerciseCreated?.();
          select(newExercise.id);
          setCustomOpen(false);
          setPickerOpen(false);
        }}
      />
    )}

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
