import { useEffect, useRef, useState } from 'react';
import { Dumbbell, Plus } from 'lucide-react';
import type { Exercise, LoggedSet, Preferences, Session, SessionExercise } from '../types';
import { ApiError, api } from '../lib/api';
import type { SaveQueue } from '../lib/queue';
import { completedSets, plannedSets, showVolume, showWeight } from '../lib/training';
import { validateLoggedSet, validateSessionDraft } from '../lib/validation';
import { restTimer } from '../lib/restTimer';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';
import { WorkoutExerciseStrip } from './WorkoutExerciseStrip';
import { WorkoutActiveExercise } from './WorkoutActiveExercise';
import { WorkoutFooter } from './WorkoutFooter';
import { WorkoutTopBar } from './WorkoutTopBar';

const payload = (session: Session, revision: number) => ({
  note: session.note,
  revision,
  exercises: session.exercises.map(e => ({
    id: e.id,
    exerciseId: e.exerciseId,
    nameSnapshot: e.name,
    note: e.note,
    prescription: e.prescription,
    sequenceGroup: e.sequenceGroup,
    substitutions: e.substitutions,
    loadModel: e.loadModel,
    sourceTemplateExerciseId: e.sourceTemplateExerciseId,
    sourceSlotKey: e.sourceSlotKey,
    sourcePhaseId: e.sourcePhaseId,
    sourcePage: e.sourcePage,
    sets: e.sets.map(s => ({
      id: s.id,
      weightKg: s.weightKg,
      reps: s.reps,
      rpe: s.rpe,
      done: s.done,
      warmup: s.warmup,
      resistanceMode: s.resistanceMode
    }))
  }))
});

export function Workout({
  session,
  preferences,
  exercises,
  queue,
  onSaved,
  onClose,
  onFinish,
  onDiscard
}: {
  session: Session;
  preferences: Preferences;
  exercises: Exercise[];
  queue: SaveQueue;
  onSaved: (s: Session) => void;
  onClose: () => void;
  onFinish: (s: Session) => void;
  onDiscard: () => void;
}) {
  const [draft, setDraft] = useState(session);
  const [now, setNow] = useState(Date.now());
  const [rest, setRest] = useState(restTimer.current);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState<'finish' | 'discard' | null>(null);
  const [retainSwaps, setRetainSwaps] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<'focus' | 'all'>('focus');
  const [activeIndex, setActiveIndex] = useState(() => {
    const firstUnfinished = session.exercises.findIndex(e => e.sets.some(s => !s.done));
    return firstUnfinished >= 0 ? firstUnfinished : 0;
  });

  const revision = useRef(session.revision);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // The timer outlives this component: minimising the workout must not cancel a rest that is
  // already counting, so the state lives in the module and the view only listens to it.
  useEffect(() => restTimer.subscribe(setRest), []);

  function change(next: Session) {
    setDraft(next);
    const validationError = validateSessionDraft(next);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    queue.push('workout', async () => {
      const saved = await api.saveWorkout(next.id, payload(next, revision.current));
      revision.current = saved.revision;
      onSaved(saved);
    });
  }

  function editSet(ei: number, si: number, patch: Partial<LoggedSet>) {
    const exercise = draft.exercises[ei];
    const loadModel = exercise?.loadModel ?? 'external';
    const resistanceMode = exercise?.sets[si]?.resistanceMode ?? 'bodyweight';
    if (
      'weightKg' in patch &&
      (loadModel === 'bodyweight_context_only' ||
        loadModel === 'reps_only' ||
        (loadModel === 'full_bodyweight' && resistanceMode === 'bodyweight'))
    )
      return;
    change({
      ...draft,
      exercises: draft.exercises.map((e, i) =>
        i === ei ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : e
      )
    });
  }

  function toggle(ei: number, si: number) {
    const set = draft.exercises[ei].sets[si];
    if (!set.done) {
      const validationError = validateLoggedSet({ ...set, done: true });
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setError('');
    editSet(ei, si, { done: !set.done });
    const plan = draft.exercises[ei].prescription[si];
    const seconds = plan?.restSeconds ?? preferences.restSeconds;
    // Started from inside the tap, which is the only moment a browser will let the app open the
    // audio session the alert depends on once the screen goes off.
    if (!set.done && seconds > 0) restTimer.start(seconds);
  }

  async function finish() {
    const validationError = validateSessionDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!done) {
      setError('Complete at least one working set before finishing.');
      return;
    }
    setBusy(true);
    try {
      queue.clear();
      const saved = await api.finishWorkout(draft.id, revision.current, retainSwaps);
      restTimer.skip();
      await onFinish(saved);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save this workout.');
      setBusy(false);
      setConfirm(null);
    }
  }

  async function swapExercise(sessionExerciseId: string, replacementExerciseId: string | null, replacementName: string) {
    setBusy(true); setError('');
    try {
      await queue.push('workout', async () => {
        const saved = await api.substituteSessionExercise(draft.id, {
          sessionExerciseId, replacementExerciseId, replacementName, revision: revision.current, idempotencyId: crypto.randomUUID()
        });
        revision.current = saved.revision; setDraft(saved); onSaved(saved);
      });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not swap this exercise.');
    } finally { setBusy(false); }
  }

  async function restoreExercise(sessionExerciseId: string) {
    setBusy(true); setError('');
    try {
      await queue.push('workout', async () => {
        const saved = await api.restoreSessionExercise(draft.id, {
          sessionExerciseId, revision: revision.current, idempotencyId: crypto.randomUUID()
        });
        revision.current = saved.revision; setDraft(saved); onSaved(saved);
      });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not restore this exercise.');
    } finally { setBusy(false); }
  }

  async function discard() {
    setBusy(true);
    try {
      queue.clear();
      await api.discardWorkout(draft.id);
      await onDiscard();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not discard this workout.');
      setBusy(false);
      setConfirm(null);
    }
  }

  function removeExercise(ei: number) {
    const remaining = draft.exercises.filter((_, i) => i !== ei);
    change({ ...draft, exercises: remaining });
    if (activeIndex >= remaining.length) {
      setActiveIndex(Math.max(0, remaining.length - 1));
    }
  }

  const elapsed = Math.max(0, Math.floor((now - Date.parse(draft.startedAt)) / 1000));
  const remaining = rest.endsAt === 0 ? 0 : Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
  const done = completedSets(draft).length;
  const unit = preferences.unit;

  const currentExercise = draft.exercises[activeIndex] ?? draft.exercises[0];

  return (
    <Modal title={draft.name} onClose={onClose} wide>
      <WorkoutTopBar
        elapsed={elapsed}
        done={done}
        planned={plannedSets(draft)}
        viewMode={viewMode}
        remaining={remaining}
        totalSeconds={rest.totalSeconds}
        onClose={onClose}
        onToggleViewMode={() => setViewMode(v => (v === 'focus' ? 'all' : 'focus'))}
      />

      <div className="workout-summary">
        <span>
          <Dumbbell size={16} />
          {showVolume(draft.volumeKg, unit)} external
        </span>
        {draft.systemVolumeKg !== null && draft.systemVolumeKg !== undefined && (
          <span>
            <Dumbbell size={16} />
            {showVolume(draft.systemVolumeKg, unit)} system
          </span>
        )}
        {draft.bodyWeight && (
          <span title="Frozen when this workout started">
            Bodyweight {showWeight(draft.bodyWeight.referenceKg, unit)}
          </span>
        )}
        {draft.nutritionContext?.cached && (
          <span title="Nutrition was unavailable when this workout started">
            Nutrition context cached
          </span>
        )}
      </div>

      <WorkoutExerciseStrip
        exercises={draft.exercises}
        activeIndex={activeIndex}
        onSelect={idx => {
          setActiveIndex(idx);
          if (viewMode === 'all') setViewMode('focus');
        }}
        onAdd={() => setPicker(true)}
      />

      <div className="modal-body workout-body">
        {viewMode === 'focus' ? (
          currentExercise ? (
            <WorkoutActiveExercise
              key={currentExercise.id}
              exercise={currentExercise}
              index={draft.exercises.indexOf(currentExercise)}
              unit={unit}
              draft={draft}
              exercises={exercises}
              change={change}
              editSet={editSet}
              toggle={toggle}
              onSwap={swapExercise}
              onRestore={restoreExercise}
              onRemoveExercise={removeExercise}
            />
          ) : (
            <div className="empty-message">
              <Dumbbell size={30} />
              <h3>No exercises in this workout</h3>
              <Button variant="primary" onClick={() => setPicker(true)}>
                <Plus size={16} />
                Add an exercise
              </Button>
            </div>
          )
        ) : (
          <div className="workout-all-exercises-list">
            {draft.exercises.map((exercise, idx) => (
              <WorkoutActiveExercise
                key={exercise.id}
                exercise={exercise}
                index={idx}
                unit={unit}
                draft={draft}
                exercises={exercises}
                change={change}
                editSet={editSet}
                toggle={toggle}
                onSwap={swapExercise}
                onRestore={restoreExercise}
                onRemoveExercise={removeExercise}
              />
            ))}
            <Button className="full-width" onClick={() => setPicker(true)}>
              <Plus size={18} />
              Add exercise
            </Button>
          </div>
        )}

        <label className="field workout-global-notes">
          Workout notes
          <textarea
            name="workout-note"
            placeholder="How did the session feel? Overall fatigue, grip, energy…"
            value={draft.note}
            onChange={e => change({ ...draft, note: e.target.value })}
          />
        </label>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>

      <WorkoutFooter
        remaining={remaining}
        totalSeconds={rest.totalSeconds}
        preferences={preferences}
        busy={busy}
        onDiscard={() => setConfirm('discard')}
        onMinimize={onClose}
        onFinish={() => {
          if (!done) {
            setError('Complete at least one working set before finishing.');
            return;
          }
          setConfirm('finish');
        }}
      />

      {picker && (
        <Modal title="Add an exercise" onClose={() => setPicker(false)}>
          <div className="modal-body">
            <ExerciseLibrary
              exercises={exercises}
              exclude={draft.exercises
                .map(e => e.exerciseId)
                .filter((id): id is string => id !== null)}
              onSelect={id => {
                const chosen = exercises.find(e => e.id === id)!;
                const newEx: SessionExercise = {
                  id: crypto.randomUUID(),
                  exerciseId: chosen.id,
                  name: chosen.name,
                  position: draft.exercises.length,
                  note: '',
                  sequenceGroup: '',
                  substitutions: [],
                  prescription: [blankPrescription(preferences.restSeconds, chosen.loadModel)],
                  sets: [blankLoggedSet(chosen.loadModel)],
                  progression: null,
                  loadModel: chosen.loadModel
                };
                change({
                  ...draft,
                  exercises: [...draft.exercises, newEx]
                });
                setActiveIndex(draft.exercises.length);
                setPicker(false);
              }}
            />
          </div>
        </Modal>
      )}

      {confirm && (
        <Modal
          title={confirm === 'finish' ? 'Finish your workout?' : 'Discard this workout?'}
          onClose={() => setConfirm(null)}
        >
          <div className="modal-body">
            <p>
              {confirm === 'finish'
                ? `${done} completed working ${done === 1 ? 'set' : 'sets'} will be saved. Unlogged sets will be left out.`
                : 'This removes the session in progress. Your completed history stays as it is.'}
            </p>
            {confirm === 'finish' &&
              draft.exercises.some(e => e.sourcePhaseId && e.isReplacement) && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={retainSwaps}
                    onChange={e => setRetainSwaps(e.target.checked)}
                  />
                  Keep exercise swaps for the remaining workouts in this phase.
                </label>
              )}
          </div>
          <div className="modal-actions">
            <Button onClick={() => setConfirm(null)}>Keep training</Button>
            <Button
              variant={confirm === 'finish' ? 'primary' : 'destructive'}
              disabled={busy}
              onClick={() => (confirm === 'finish' ? void finish() : void discard())}
            >
              {confirm === 'finish' ? 'Save workout' : 'Discard workout'}
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function blankPrescription(
  restSeconds: number,
  loadModel?: Exercise['loadModel'],
  resistanceMode?: LoggedSet['resistanceMode']
): SessionExercise['prescription'][number] {
  return {
    repMin: 8,
    repMax: 12,
    targetRpe: 8,
    restSeconds,
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
    resistanceMode: normalizeResistanceMode(loadModel, resistanceMode)
  };
}

function blankLoggedSet(
  loadModel?: Exercise['loadModel'],
  resistanceMode?: LoggedSet['resistanceMode']
): LoggedSet {
  return {
    id: crypto.randomUUID(),
    position: 0,
    weightKg: null,
    reps: null,
    rpe: null,
    done: false,
    warmup: false,
    resistanceMode: normalizeResistanceMode(loadModel, resistanceMode)
  };
}

function normalizeResistanceMode(
  loadModel?: Exercise['loadModel'],
  resistanceMode?: LoggedSet['resistanceMode']
): LoggedSet['resistanceMode'] {
  if (loadModel === 'full_bodyweight')
    return resistanceMode === 'added' ||
      resistanceMode === 'assistance' ||
      resistanceMode === 'bodyweight'
      ? resistanceMode
      : 'bodyweight';
  return loadModel === 'bodyweight_context_only' || loadModel === 'reps_only'
    ? 'reps_only'
    : 'external';
}
