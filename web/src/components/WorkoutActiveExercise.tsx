import { useEffect, useRef, useState } from 'react';
import {
  ChartLine,
  Check,
  ClipboardList,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Timer,
  Trash2,
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
import { restOptions } from '../lib/training';
import { showExerciseWeight } from '../lib/weightBasis';
import { ProgressionChangeBadge } from './ProgressionChangeBadge';
import { setNumberLabel, withSetAdded, withSetRemoved, withSetsRestored } from '../lib/workoutDraft';
import { allowedSetTypes, withSetType } from '../lib/workoutSetTypes';
import type { RemovedSet } from '../lib/workoutDraft';
import { Button } from './ui/Button';
import { TextAreaField } from './ui/Field';
import { Modal } from './ui/Modal';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { Select } from './ui/Select';
import { ExerciseLibrary } from './Exercises';
import { WorkoutSetRow } from './WorkoutSetRow';
import { WorkoutWarmupButton } from './WorkoutWarmupButton';
import { warmupOffer, withWarmups } from '../lib/workoutWarmups';
import { DemoLink } from './ui/DemoLink';
import { isTimedExercise } from '../lib/setDuration';
import { useTrackRir } from '../lib/trackRir';
import { ExerciseLoadSettings } from './ExerciseLoadSettings';
import { WorkoutTargetsModal } from './WorkoutTargetsModal';
import { loadAdjustable } from '../lib/exerciseLoads';
import { canEnterPerSide } from '../lib/equipmentGroups';
import { loadColumnLabel, loadEntryFor } from '../lib/resistanceVariant';
import { exerciseRestSeconds } from '../lib/restRules';
import './WorkoutLogger.css';

// Long enough to notice a mistaken swipe-delete and reach Undo, short enough not to linger. Each
// further removal restarts it, so a quick run of deletes stays undoable as one.
const UNDO_WINDOW_MS = 5000;

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
  onCatalogNeeded,
  onOpenExercise
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
  /// Opens the library details (progress chart, records, history) over the workout.
  onOpenExercise?: (exerciseId: string) => void;
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

  const [removed, setRemoved] = useState<{ sets: RemovedSet[]; label: string } | null>(null);

  const prescription = exercise.prescription;
  const loadEntry = loadEntryFor(exercise);

  // A removed set can be put back for a few seconds, so a mis-tap never costs a logged set.
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [removed]);

  function removeSet(setIndex: number) {
    const removal = withSetRemoved(draft, index, setIndex);
    if (!removal) return;
    change(removal.next);
    // Named as the row showed it, so a warm-up reads W1 rather than its position.
    const label = setNumberLabel(exercise, setIndex).label;
    setRemoved(current => ({ sets: [...(current?.sets ?? []), removal.removed], label }));
  }

  function undoRemoveSet() {
    const restored = removed && withSetsRestored(draft, removed.sets);
    setRemoved(null);
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
  const warmups = warmupOffer(draft, index, exercises, unit);
  const nextUnloggedWorkingIndex = workingSets.findIndex(s => !s.done);
  // The row the lifter is on: the first set, warm-up or working, still to log.
  const nextSetIndex = exercise.sets.findIndex(s => !s.done);
  const currentSetDisplay = nextUnloggedWorkingIndex >= 0
    ? `Set ${nextUnloggedWorkingIndex + 1} of ${workingSets.length || exercise.sets.length}`
    : 'All sets completed';


  return (
    <section className="workout-active-exercise">
      <div className="workout-active-header">
        <div className="workout-active-title-group">
          <h2>{exercise.name}</h2>
          <div className="workout-active-meta">
            {currentSetDisplay && <span className={`workout-set-progress ${nextUnloggedWorkingIndex < 0 ? 'complete' : ''}`.trim()}>
              {nextUnloggedWorkingIndex < 0 && <Check size={15} strokeWidth={3} aria-hidden="true" />}{currentSetDisplay}
            </span>}
            {exercise.isReplacement && (
              <span className="tiny-label">Swapped · {exercise.originalName}</span>
            )}
            {!exercise.exerciseId && <span className="tiny-label warn">Not in library</span>}
            <DemoLink url={exercise.demoUrl} exerciseName={exercise.name} />
          </div>
          {exercise.progression?.lastE1rmKg != null && (
            <p className="workout-last-time">
              Last time: e1RM {showExerciseWeight(exercise.progression.lastE1rmKg, unit, exercise)}
              {lastSourceDate && ` · ${new Date(lastSourceDate.length === 10 ? `${lastSourceDate}T00:00` : lastSourceDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
            </p>
          )}
        </div>

        <ProgressionChangeBadge exercise={exercise} unit={unit} />
      </div>

      <div ref={actionToolbar} className="workout-action-pills" role="toolbar" aria-label="Exercise actions" data-swipe-ignore="">
        <Button
          variant="tertiary"
          className="action-pill"
          aria-haspopup="dialog"
          onClick={() => setShowTargets(true)}
        >
          <ClipboardList size={15} />
          <span>Targets</span>
        </Button>

        {/* Only a library exercise has progress to show; a name typed mid-workout has none yet. */}
        {exercise.exerciseId && onOpenExercise && (
          <Button
            variant="tertiary"
            className="action-pill"
            aria-haspopup="dialog"
            aria-label={`${exercise.name} progress and history`}
            onClick={() => onOpenExercise(exercise.exerciseId!)}
          >
            <ChartLine size={15} />
            <span>Progress</span>
          </Button>
        )}

        {/* Swapping only works before a set is logged, so it leaves the row rather than sit greyed out. */}
        {!hasCompletedSets && (
          <Button
            variant="tertiary"
            className="action-pill"
            aria-label={`Swap ${exercise.name}`}
            onClick={() => setSwapOpen(true)}
          >
            <RefreshCw size={15} />
            <span>Swap</span>
          </Button>
        )}

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
        <WorkoutTargetsModal exercise={exercise} unit={unit} trackRir={trackRir}
          onClose={() => setShowTargets(false)} />
      )}

      {loadEntry === 'assistance' && (
        <p className="load-assist-hint">Assistance takes weight off you, so a higher number is an easier set.</p>
      )}
      <div className={`workout-set-table-container ${trackRir ? '' : 'no-rir'} ${isTimedExercise(exercise) ? 'timed' : ''}`.trim()}>
        <div className="workout-set-table-head">
          <span className="col-set">Set</span>
          <span className="col-target">Target</span>
          <span className="col-load" title={exercise.weightBasis === 'per_side' ? 'Weight of one dumbbell or one side' : 'Total weight'}>{loadColumnLabel(loadEntry, unit, exercise)}</span>
          {isTimedExercise(exercise) ? (
            <span className="col-reps col-time">Time</span>
          ) : (
            <>
              <span className="col-reps">{trackRir ? 'Reps / RIR' : 'Reps'}</span>
            </>
          )}
          <span className="col-log"><Check size={16} strokeWidth={2.5} aria-hidden="true" /><span className="sr-only">Done</span></span>
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
                current={si === nextSetIndex}
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
          {removed && (
            <div className="workout-set-undo" role="status">
              <span>{removed.sets.length === 1 ? `Set ${removed.label} removed.` : `${removed.sets.length} sets removed.`}</span>
              <Button variant="tertiary" onClick={undoRemoveSet}>Undo</Button>
            </div>
          )}
          <div className="workout-set-table-actions">
            <Button
              variant="secondary"
              className="add-set-btn"
              disabled={exercise.sets.length >= 24}
              onClick={() => change(withSetAdded(draft, index))}
            >
              <Plus size={16} />
              Add set
            </Button>
            {warmups && <WorkoutWarmupButton exercise={exercise} offer={warmups} unit={unit}
              catalogReady={Boolean(libraryExercise) || !exercise.exerciseId} loadCatalog={onCatalogNeeded}
              onApply={steps => change(withWarmups(draft, index, steps))} />}
          </div>
        </div>
      </div>

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
                value={exerciseRestSeconds(exercise, 90)}
                options={restOptions(exerciseRestSeconds(exercise, 90))}
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
