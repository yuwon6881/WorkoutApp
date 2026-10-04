import { useEffect, useRef, useState } from 'react';
import {
  ClipboardList,
  FileText,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Timer,
  Trash2,
  TrendingUp,
  Weight
} from 'lucide-react';
import type {
  Exercise,
  LoggedSet,
  Preferences,
  Session,
  SessionExercise
} from '../types';
import { api } from '../lib/api';
import { restOptions, showTarget, showWeight } from '../lib/training';
import { withSetAdded, withSetRemoved, withSetRestored } from '../lib/workoutDraft';
import { allowedSetTypes, withSetType } from '../lib/workoutSetTypes';
import type { RemovedSet } from '../lib/workoutDraft';
import { Button } from './ui/Button';
import { TextAreaField } from './ui/Field';
import { Modal } from './ui/Modal';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { Select } from './ui/Select';
import { ExerciseLibrary } from './Exercises';
import { WorkoutSetRow } from './WorkoutSetRow';
import { useRecentExerciseSets } from './useRecentExerciseSets';
import { previousSetSummaries } from '../lib/previousSets';
import { DemoLink } from './ui/DemoLink';
import { isTimedExercise } from '../lib/setDuration';
import { useTrackRir } from '../lib/trackRir';
import { ExerciseLoadSettings } from './ExerciseLoadSettings';
import { loadAdjustable } from '../lib/exerciseLoads';
import { canEnterPerSide } from '../lib/equipmentGroups';
import { loadColumnLabel, loadEntryFor } from '../lib/resistanceVariant';

const UNDO_WINDOW_MS = 6000;

export function WorkoutActiveExercise({
  exercise,
  index,
  unit,
  draft,
  exercises,
  change,
  editSet,
  toggle,
  onSwap,
  onRestore,
  onRemoveExercise,
  onCatalogChanged,
  onCatalogNeeded
}: {
  exercise: SessionExercise;
  index: number;
  unit: Preferences['unit'];
  draft: Session;
  exercises: Exercise[];
  change: (s: Session) => void;
  editSet: (ei: number, si: number, patch: Partial<LoggedSet>) => void;
  toggle: (ei: number, si: number) => void | boolean | Promise<void | boolean>;
  onSwap: (sessionExerciseId: string, replacementExerciseId: string | null, replacementName: string) => Promise<void>;
  onRestore?: (sessionExerciseId: string) => Promise<void>;
  onRemoveExercise: (index: number) => void;
  onCatalogChanged?: () => void | Promise<void>;
  onCatalogNeeded?: () => Promise<void>;
}) {
  const trackRir = useTrackRir();
  const [swapOpen, setSwapOpen] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [restTimerOpen, setRestTimerOpen] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [focusedLoads, setFocusedLoads] = useState<Pick<Exercise, 'loadStepKg' | 'availableLoadsKg'> | null>(null);
  const loadCatalog = () => {
    setCatalogError('');
    void onCatalogNeeded?.().catch(failure => setCatalogError(failure instanceof Error ? failure.message : 'Exercises could not be loaded.'));
  };
  const [showTargets, setShowTargets] = useState(false);
  const [showNote, setShowNote] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const actionToolbar = useRef<HTMLDivElement>(null);
  const restoreWeightFocus = useRef(false);

  useEffect(() => {
    if (weightsOpen || !restoreWeightFocus.current) return;
    // Wait for the nested dialog to unmount before focusing the underlying workout.
    actionToolbar.current?.querySelector<HTMLButtonElement>('.ui-menu-trigger')?.focus();
    restoreWeightFocus.current = false;
  }, [weightsOpen]);

  function closeWeights() {
    restoreWeightFocus.current = true;
    setWeightsOpen(false);
  }

  const [removedSet, setRemovedSet] = useState<RemovedSet | null>(null);

  const prescription = exercise.prescription;
  const loadEntry = loadEntryFor(exercise);

  // A removed set can be put back for a few seconds, so a mis-tap never costs a logged set.
  useEffect(() => {
    if (!removedSet) return;
    const timer = setTimeout(() => setRemovedSet(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [removedSet]);

  function removeSet(setIndex: number) {
    const removal = withSetRemoved(draft, index, setIndex);
    if (!removal) return;
    change(removal.next);
    setRemovedSet(removal.removed);
  }

  function undoRemoveSet() {
    const restored = removedSet && withSetRestored(draft, removedSet);
    setRemovedSet(null);
    if (restored) change(restored);
  }

  // The library already ranks the program's alternatives and similar movements first, so it is
  // the whole swap picker.
  useEffect(() => {
    if (swapOpen) loadCatalog();
  }, [swapOpen]);

  const lastSourceDate = exercise.sets.find(set => set.suggestion?.sourceDate)?.suggestion?.sourceDate ?? null;
  const workingSets = exercise.sets.filter(s => !s.warmup);
  const hasCompletedSets = exercise.sets.some(s => s.done);
  const libraryExercise = exercises.find(item => item.id === exercise.exerciseId);
  useEffect(() => {
    setFocusedLoads(null);
    if (libraryExercise || !exercise.exerciseId || !loadAdjustable(exercise)) return;
    const controller = new AbortController();
    void api.exerciseLoadSettings(exercise.exerciseId, unit, controller.signal).then(settings => {
      if (!controller.signal.aborted) setFocusedLoads(settings);
    }).catch(() => { /* Explicit load entry and durable offline logging remain available. */ });
    return () => controller.abort();
  }, [exercise.exerciseId, exercise.loadModel, libraryExercise, unit]);
  const resolvedLoads = libraryExercise ?? focusedLoads;
  const nextUnloggedWorkingIndex = workingSets.findIndex(s => !s.done);
  // The strip and the rows already show a finished exercise, so progress is only worth a line
  // while there is still a set to log.
  const currentSetDisplay = nextUnloggedWorkingIndex >= 0
    ? `Set ${nextUnloggedWorkingIndex + 1} of ${workingSets.length || exercise.sets.length}`
    : null;
  const previousSets = previousSetSummaries(useRecentExerciseSets(exercise.exerciseId), exercise, trackRir);

  const progressionBadge = exercise.progression?.suggestedKg != null ? (
    <div className="workout-progression-badge" title={exercise.progression.reason}>
      <TrendingUp size={14} />
      <span className="badge-weight">{showWeight(exercise.progression.suggestedKg, unit)}</span>
      {exercise.progression.trendE1rmKg != null && (
        <span className="badge-sub">e1RM {showWeight(exercise.progression.trendE1rmKg, unit)}</span>
      )}
    </div>
  ) : null;

  return (
    <section className={`workout-active-exercise ${exercise.isReplacement ? 'swap-continuation' : ''}`}>
      <div className="workout-active-header">
        <div className="workout-active-title-group">
          <h2>
            {exercise.isReplacement && exercise.originalName
              ? `Continuation · ${exercise.name}`
              : exercise.name}
          </h2>
          <div className="workout-active-meta">
            {currentSetDisplay && <span className="workout-set-progress">{currentSetDisplay}</span>}
            {exercise.isReplacement && (
              <span className="tiny-label">Swapped · {exercise.originalName}</span>
            )}
            {!exercise.exerciseId && <span className="tiny-label warn">Not in library</span>}
            <DemoLink url={exercise.demoUrl} exerciseName={exercise.name} />
          </div>
          {exercise.progression?.lastE1rmKg != null && (
            <p className="workout-last-time">
              Last time: e1RM {showWeight(exercise.progression.lastE1rmKg, unit)}
              {lastSourceDate && ` · ${new Date(lastSourceDate.length === 10 ? `${lastSourceDate}T00:00` : lastSourceDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
            </p>
          )}
        </div>

        {progressionBadge}
      </div>

      <div ref={actionToolbar} className="workout-action-pills" role="toolbar" aria-label="Exercise actions">
        <Button
          variant="tertiary"
          className="action-pill"
          aria-haspopup="dialog"
          onClick={() => setShowTargets(true)}
        >
          <ClipboardList size={15} />
          <span>Targets</span>
        </Button>

        <Button
          variant="tertiary"
          className="action-pill"
          aria-label={`Swap ${exercise.name}`}
          disabled={hasCompletedSets}
          title={hasCompletedSets ? 'Swapping is not available after completing sets.' : undefined}
          onClick={() => setSwapOpen(true)}
        >
          <RefreshCw size={15} />
          <span>Swap</span>
        </Button>

        {exercise.canRestore && (
          <Button
            variant="tertiary"
            className="action-pill"
            aria-label={`Restore default for ${exercise.name}`}
            onClick={() => void onRestore?.(exercise.id)}
          >
            <RotateCcw size={15} />
            <span>Restore default</span>
          </Button>
        )}

        <Button
          variant="tertiary"
          className={`action-pill ${showNote ? 'active' : ''}`}
          aria-pressed={showNote}
          onClick={() => setShowNote(s => !s)}
        >
          <FileText size={15} />
          <span>Note</span>
        </Button>

        {exercise.sequenceGroup && (
          <div className="action-pill pill-static" title="Superset group">
            <Layers size={15} />
            <span>Superset {exercise.sequenceGroup}</span>
          </div>
        )}

        <MenuButton label={`Actions for ${exercise.name}`} variant="tertiary" portal>
          <MenuItem onClick={() => setRestTimerOpen(true)}>
            <Timer size={15} /> Rest timer
          </MenuItem>
          {exercise.exerciseId && loadAdjustable(exercise) && <MenuItem onClick={() => { setWeightsOpen(true); loadCatalog(); }}>
            <Weight size={15} /> Weight settings
          </MenuItem>}
          {exercise.sourceTemplateExerciseId && !exercise.canRestore && <MenuItem onClick={() => void onRestore?.(exercise.id)}>
            <RotateCcw size={15} /> Restore default
          </MenuItem>}
          <MenuItem destructive onClick={() => setConfirmRemove(true)}>
            <Trash2 size={15} /> Remove exercise
          </MenuItem>
        </MenuButton>
      </div>

      {showTargets && (
        <Modal title={`${exercise.name} targets`} onClose={() => setShowTargets(false)}>
          <div className="modal-body workout-plan-detail-card">
          {exercise.progression && <p className="plan-detail-heading muted">{exercise.progression.reason}</p>}
          <ul className="plan-detail-list">
            {(prescription.some(p => !p.warmup) ? prescription.filter(p => !p.warmup) : prescription).map((p, pi) => (
              <li key={pi}>
                <span className="plan-set-number">{`Set ${pi + 1}`}</span>
                <div className="plan-set-prescription">
                  <span className="plan-set-target">{showTarget(p, trackRir)}</span>
                  {p.loadText && <span className="plan-set-load">{p.loadText}</span>}
                  {p.tempo && <span className="plan-set-tempo">Tempo {p.tempo}</span>}
                  {p.notes && <span className="plan-set-notes">{p.notes}</span>}
                </div>
              </li>
            ))}
          </ul>
          </div>
        </Modal>
      )}

      {loadEntry === 'assistance' && (
        <p className="load-assist-hint">Assistance takes weight off you, so a higher number is an easier set.</p>
      )}
      <div className={`workout-set-table-container ${trackRir ? '' : 'no-rir'} ${isTimedExercise(exercise) ? 'timed' : ''}`.trim()}>
        <div className="workout-set-table-head">
          <span className="col-set">Set</span>
          <span className="col-target">Target</span>
          <span className="col-load">{loadColumnLabel(loadEntry, unit)}</span>
          {isTimedExercise(exercise) ? (
            <span className="col-reps col-time">Time</span>
          ) : (
            <>
              <span className="col-reps">{trackRir ? 'Reps / RIR' : 'Reps'}</span>
            </>
          )}
          <span className="col-log">Done</span>
          <span className="col-del" />
        </div>

        <div className="workout-set-rows">
          {exercise.sets.map((set, si) => {
            const plan = prescription[si] ?? prescription.at(-1);
            return (
              <WorkoutSetRow
                key={set.id}
                set={set}
                si={si}
                ei={index}
                exercise={exercise}
                plan={plan}
                previous={previousSets[si]}
                unit={unit}
                loadStepKg={resolvedLoads?.loadStepKg}
                availableLoadsKg={resolvedLoads?.availableLoadsKg}
                editSet={editSet}
                toggle={toggle}
                paused={Boolean(draft.pausedAt)}
                setTypes={allowedSetTypes(exercise, si)}
                onSetType={(sidx, type) => change(withSetType(draft, index, sidx, type))}
                onRemoveSet={sidx => removeSet(sidx)}
              />
            );
          })}
        </div>

        <div className="workout-set-table-footer">
          {removedSet && (
            <div className="workout-set-undo" role="status">
              <span>Set {removedSet.index + 1} removed.</span>
              <Button variant="tertiary" onClick={undoRemoveSet}>Undo</Button>
            </div>
          )}
          <Button
            variant="secondary"
            className="add-set-btn"
            disabled={exercise.sets.length >= 24}
            onClick={() => change(withSetAdded(draft, index))}
          >
            <Plus size={16} />
            Add set
          </Button>
        </div>
      </div>

      {showNote && (
        <div className="workout-note-drawer">
          <TextAreaField
            label="Exercise notes"
            autoGrow
            name={`note-${exercise.id}`}
            placeholder="Form cues, machine pin setup, seat height..."
            value={exercise.note}
            onChange={event => change({
              ...draft,
              exercises: draft.exercises.map((item, i) =>
                i === index ? { ...item, note: event.target.value } : item
              )
            })}
          />
        </div>
      )}

      {confirmRemove && (
        <Modal title={`Remove ${exercise.name}?`} onClose={() => setConfirmRemove(false)}>
          <div className="modal-body">
            <p>
              {hasCompletedSets
                ? `The ${exercise.sets.filter(s => s.done).length === 1 ? 'set' : 'sets'} you logged for it in this workout will be removed too.`
                : 'It will be taken out of this workout only; the saved routine stays as it is.'}
            </p>
          </div>
          <div className="modal-actions">
            <Button onClick={() => setConfirmRemove(false)}>Keep exercise</Button>
            <Button variant="destructive" onClick={() => { setConfirmRemove(false); onRemoveExercise(index); }}>
              Remove exercise
            </Button>
          </div>
        </Modal>
      )}

      {weightsOpen && (
        <Modal title={`${exercise.name} weights`} onClose={closeWeights}>
          <div className="modal-body">
            {libraryExercise ? <ExerciseLoadSettings exerciseId={libraryExercise.id} exerciseName={exercise.name} unit={unit} editor
              perSide={canEnterPerSide(libraryExercise)} onClose={closeWeights} onChanged={onCatalogChanged} /> : <div role="status">
              <p>{catalogError || 'Loading weight settings…'}</p>
              {catalogError && <Button variant="secondary" onClick={loadCatalog}>Retry</Button>}
            </div>}
          </div>
        </Modal>
      )}

      {restTimerOpen && (
        <Modal title={`${exercise.name} rest timer`} onClose={() => setRestTimerOpen(false)}>
          <div className="modal-body">
            <p className="muted" style={{ margin: 0 }}>
              Adjust the rest interval between sets for this exercise.
            </p>
            <label className="field">
              Rest duration
              <Select
                ariaLabel="Rest duration"
                value={exercise.restSeconds ?? exercise.prescription[0]?.restSeconds ?? 90}
                options={restOptions(exercise.restSeconds ?? exercise.prescription[0]?.restSeconds ?? 90)}
                onChange={val => {
                  const sec = Number(val);
                  change({
                    ...draft,
                    exercises: draft.exercises.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            restSeconds: sec,
                            prescription: item.prescription.map(p => ({ ...p, restSeconds: sec }))
                          }
                        : item
                    )
                  });
                }}
              />
            </label>
            <div className="modal-actions" style={{ padding: 0, border: 0, marginTop: 12 }}>
              <Button variant="primary" onClick={() => setRestTimerOpen(false)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}

      {swapOpen && (
        <Modal wide title={`Swap ${exercise.name}`} onClose={() => setSwapOpen(false)}>
          <div className="modal-body">
            {catalogError && <div role="status"><p>{catalogError}</p><Button variant="secondary" onClick={loadCatalog}>Retry exercises</Button></div>}
            <p className="source">
              Prescribed sets, reps, and targets stay with the slot. Swapping is only available before any sets are completed.
            </p>
            <ExerciseLibrary
              exercises={exercises}
              action="swap"
              currentExerciseId={exercise.exerciseId}
              preferredNames={exercise.substitutions}
              onSelect={id => {
                const chosen = exercises.find(item => item.id === id);
                if (chosen)
                  void onSwap(exercise.id, chosen.id, chosen.name).then(() => setSwapOpen(false));
              }}
            />
          </div>
        </Modal>
      )}
    </section>
  );
}
