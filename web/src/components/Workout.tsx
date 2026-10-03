import { useCallback, useEffect, useRef, useState } from 'react';
import type { Exercise, LoggedSet, Preferences, RestMutationInput, Session, SessionRest } from '../types';
import { ApiError, api } from '../lib/api';
import type { SaveQueue } from '../lib/queue';
import { completedSets, finishBlocker, plannedSets } from '../lib/training';
import { exerciseListChanged, withServerFlags } from '../lib/workoutDraft';
import { firstOpenExercise, nextUpText, type AdvanceOptions } from '../lib/workoutLogging';
import { useAfterLog } from './useAfterLog';
import { validateLoggedSet, validateSessionDraft } from '../lib/validation';
import { restTimer } from '../lib/restTimer';
import { stopStopwatch } from '../lib/setStopwatch';
import { findNextStep, restAppliesAfter } from '../lib/restRules';
import {
  clearRecovery, enqueueFinish, enqueueSave, enqueueSetEdits, enqueueTiming, getRecovery,
  isStorageFailure, persistDraftOnly, saveNavigation,
  startRecovery
} from '../lib/workoutRecovery';
import { startRestAfterSetIsDurable } from '../lib/workoutRecoveryActions';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import { drainWorkoutOutbox, sessionPayload } from '../lib/workoutOutbox';
import { Modal } from './ui/Modal';
import { WorkoutFooter } from './WorkoutFooter';
import { WorkoutRestBar } from './WorkoutRestBar';
import { WorkoutDetailsModal, hasWorkoutDetails } from './WorkoutDetails';
import { WorkoutTopBar } from './WorkoutTopBar';
import { WorkoutEditor } from './WorkoutEditor';
import { WorkoutRecoveryConflict } from './WorkoutRecoveryConflict';
import { useWorkoutOnlineFallback } from './useWorkoutOnlineFallback';
import { useWorkoutRest } from './useWorkoutRest';
import { useWorkoutConflictResolution } from './useWorkoutConflictResolution';
import { useWorkoutExerciseList } from './useWorkoutExerciseList';
import { WorkoutConfirmModal } from './WorkoutConfirmModal';
import { useFinishPlanUpdate } from './useFinishPlanUpdate';
import { useStopwatchRecovery } from './useStopwatchRecovery';
import './ActiveWorkout.css';

export function Workout({
  session,
  accountId,
  preferences,
  exercises,
  queue,
  online,
  recovery,
  onRecoveryChange,
  onSaved,
  onClose,
  onFinish,
  onDiscard,
  advance,
  onCatalogChanged,
  onCatalogNeeded,
  continues = false
}: {
  session: Session;
  accountId: string;
  preferences: Preferences;
  exercises: Exercise[];
  queue: SaveQueue;
  online: boolean;
  recovery: WorkoutRecoveryRecord | null;
  onRecoveryChange: (record: WorkoutRecoveryRecord | null) => void;
  onSaved: (s: Session) => void;
  onClose: () => void;
  onFinish: (s: Session) => void;
  onDiscard: () => void;
  advance?: AdvanceOptions;
  /** Weight settings changed mid-workout, so the exercise catalog is read again. */
  onCatalogChanged?: () => void | Promise<void>;
  onCatalogNeeded?: () => Promise<void>;
  /** Replaces the starting stand-in already on screen, so the sheet does not rise again. */
  continues?: boolean;
}) {
  const [draft, setDraft] = useState(recovery?.sessionId === session.id ? recovery.draft : session);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState<'finish' | 'discard' | 'restore' | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const planUpdate = useFinishPlanUpdate(draft, confirm === 'finish', online, exercises);
  const [error, setError] = useState('');
  const loadCatalog = () => { void onCatalogNeeded?.().catch(failure => setError(failure instanceof Error ? failure.message : 'Exercises could not be loaded. Try again.')); };
  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => recovery?.activeIndex ?? firstOpenExercise(session));
  const [finishIntentAt, setFinishIntentAt] = useState(() => recovery?.operations.find(operation => operation.type === 'finish')?.finishedAt ?? null);
  const [localStatus, setLocalStatus] = useState('');
  const [recoveryConflict, setRecoveryConflict] = useState(recovery?.conflict ?? false);
  useStopwatchRecovery(accountId, session.id, recovery);

  const serverSession = useRef(recovery?.serverSession ?? session);
  const revision = useRef(serverSession.current.revision);
  const setToggleGenerations = useRef(new Map<string, number>());
  const { celebration, afterLog } = useAfterLog({
    unit: preferences.unit, advance, onAdvance: index => selectExercise(index)
  });
  const onlineFallback = useWorkoutOnlineFallback({
    sessionId: session.id, accountId, online, queue, preferences, recovery, revision,
    serverSession, onSaved, onRecoveryChange, setDraft, setBusy, setError, setLocalStatus
  });

  useEffect(() => {
    if (recovery) {
      serverSession.current = recovery.serverSession;
      revision.current = recovery.serverSession.revision;
      setRecoveryConflict(recovery.conflict);
      const pendingFinish = recovery.operations.find(operation => operation.type === 'finish');
      setFinishIntentAt(pendingFinish?.type === 'finish' ? pendingFinish.finishedAt : null);
      setDraft(recovery.draft);
      setActiveIndex(recovery.activeIndex);
      return;
    }
    void startRecovery({
      accountId, displayName: '', sessionId: session.id, draft: session, serverSession: session,
      preferences, activeIndex
    }).then(async () => onRecoveryChange(await getRecovery(accountId)))
      .catch(() => setLocalStatus('This workout is not recoverable on this device.'));
  }, [accountId, session.id]);


  const drain = useCallback(async () => {
    if (!online || recoveryConflict) return;
    await drainWorkoutOutbox(accountId, session.id, () => serverSession.current, {
      onSaved: (saved, nextRecovery) => {
        serverSession.current = saved;
        revision.current = saved.revision;
        onSaved(saved);
        setDraft(current => withServerFlags(current, saved));
        onRecoveryChange(nextRecovery);
        setLocalStatus(nextRecovery?.operations.length ? 'Saving…' : 'Synced.');
      },
      onFinished: onFinish,
      onConflict: nextRecovery => {
        setRecoveryConflict(true);
        onRecoveryChange(nextRecovery);
        setError('This workout changed on another device. Your local copy is safe; choose which version to keep.');
      }
    });
  }, [accountId, online, recoveryConflict, session.id, onSaved, onFinish, onRecoveryChange]);

  useEffect(() => {
    if (!online || !recovery?.operations.length || recovery.conflict) return;
    const timer = setTimeout(() => queue.push('workout', drain), 250);
    return () => clearTimeout(timer);
  }, [online, recovery?.operations.length, recovery?.conflict, queue, drain]);

  useEffect(() => queue.subscribe(status => {
    if (status.state === 'offline' && recovery?.operations.length) setLocalStatus('Saved on this device. Waiting for a connection to sync.');
  }), [queue, recovery?.operations.length]);

  async function change(
    next: Session,
    changedSet?: { setId: string; patch: Partial<LoggedSet> },
    restMutation?: RestMutationInput | null,
    restState?: SessionRest | null
  ): Promise<boolean> {
    if (finishIntentAt) { setError('This workout is finished on this device and is waiting to sync.'); return false; }
    if (onlineFallback.hasPendingFinish()) { setError('A finish request needs confirmation. Retry the same finish before making more changes.'); return false; }
    if (!online && exerciseListChanged(draft, next)) {
      setError('Adding, removing, or replacing exercises needs a connection. Sets and notes are saved on this device.');
      return false;
    }
    setDraft(next);
    const validationError = validateSessionDraft(next);
    if (validationError) {
      setError(validationError);
      try { onRecoveryChange(await persistDraftOnly(accountId, next, { activeIndex })); }
      catch { setLocalStatus('This unfinished edit could not be saved on the device.'); }
      return false;
    }
    setError('');
    setLocalStatus('Saving on this device…');
    const persist = changedSet
      ? enqueueSetEdits(accountId, next, { activeIndex }, restMutation, restState)
      : enqueueSave(accountId, next, { activeIndex });
    try {
      const record = await persist;
      onRecoveryChange(record);
      setLocalStatus(online ? 'Saved on this device. Syncing…' : 'Saved on this device. Waiting for a connection to sync.');
      return true;
    } catch (failure) {
      if (online && !recoveryConflict && (!recovery || isStorageFailure(failure))) {
        const message = failure instanceof Error ? failure.message : '';
        if (/changed on the server|another device|review both versions/i.test(message)) { setError(message); return false; }
        try {
          queue.push('workout-without-device-recovery', async () => {
            const saved = await api.saveWorkout(next.id, sessionPayload(next, revision.current, crypto.randomUUID()));
            serverSession.current = saved;
            revision.current = saved.revision;
            onSaved(saved);
            setDraft(current => withServerFlags(current, saved));
            setLocalStatus('Saved to the server. Device recovery is unavailable on this browser.');
          });
          await queue.whenIdle();
          return true;
        } catch (fallbackFailure) {
          setDraft(draft);
          setError(fallbackFailure instanceof Error ? fallbackFailure.message : 'Could not save this workout to the server.');
          return false;
        }
      }
      setDraft(draft);
      setError(failure instanceof Error ? failure.message : 'Could not save this workout on the device.');
      return false;
    }
  }

  async function editSet(
    ei: number,
    si: number,
    patch: Partial<LoggedSet>,
    restMutation?: RestMutationInput | null,
    restState?: SessionRest | null
  ): Promise<boolean> {
    const exercise = draft.exercises[ei];
    const loadModel = exercise?.loadModel ?? 'external';
    const resistanceMode = exercise?.sets[si]?.resistanceMode ?? 'bodyweight';
    if (
      'weightKg' in patch &&
      (loadModel === 'bodyweight_context_only' ||
        loadModel === 'reps_only' ||
        (loadModel === 'full_bodyweight' && resistanceMode === 'bodyweight'))
    )
      return false;
    const next = {
      ...draft,
      exercises: draft.exercises.map((e, i) =>
        i === ei ? { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) } : e
      )
    };
    return change(next, { setId: exercise.sets[si].id, patch }, restMutation, restState);
  }

  async function toggle(ei: number, si: number) {
    const stored = draft.exercises[ei].sets[si];
    const timed = (stored.done ? null : stopStopwatch(stored.id)) || null;
    const set = timed === null ? stored : { ...stored, durationSeconds: timed };
    if (!set.done) {
      const validationError = validateLoggedSet({ ...set, done: true });
      if (validationError) {
        if (validationError !== 'A completed set needs its reps or time.') {
          setError(validationError);
        }
        return false;
      }
    }
    setError('');
    const setGeneration = setToggleGenerations.current;
    const generation = (setGeneration.get(set.id) ?? 0) + 1;
    setGeneration.set(set.id, generation);
    const exercise = draft.exercises[ei];
    const plan = exercise.prescription[si];
    const restSeconds = exercise.restSeconds ?? preferences.restSeconds ?? 90;
    const nextStep = findNextStep(draft.exercises, ei, si);
    const shouldRest = !set.done && restSeconds > 0 && !draft.pausedAt && restAppliesAfter({ exercise, setIndex: si, set, prescription: plan }, nextStep);
    const logging = !set.done;

    let restMutation: RestMutationInput | null = null;
    let restState: SessionRest | null = null;
    let plannedGen: string | undefined;

    if (shouldRest) {
      plannedGen = crypto.randomUUID();
      const deadlineUtc = new Date(Date.now() + restSeconds * 1000).toISOString();
      restMutation = {
        revision: revision.current,
        action: 'start',
        seconds: restSeconds,
        generation: plannedGen,
        occurredAt: new Date().toISOString()
      };
      restState = {
        generation: plannedGen,
        status: 'running',
        deadlineUtc,
        pausedRemainingMs: null,
        durationMs: restSeconds * 1000,
        originDeviceId: null
      };
    }

    const patch: Partial<LoggedSet> = timed === null ? { done: !set.done } : { done: true, durationSeconds: timed };
    const persist = () => editSet(ei, si, patch, restMutation, restState);
    let saved: boolean;
    if (shouldRest) {
      restTimer.primeSound();
      saved = await startRestAfterSetIsDurable(persist, () => {
        if (setGeneration.get(set.id) === generation) restTimer.start(restSeconds, plannedGen);
      });
    } else {
      saved = await persist();
      // An early completion replaces the previous rest too: an immediate handoff
      // must not leave an older countdown running over the superset partner.
      if (logging && saved && setGeneration.get(set.id) === generation) restTimer.skip();
    }
    if (logging && saved && setGeneration.get(set.id) === generation) afterLog(draft, ei, si);
    return saved;
  }

  async function togglePause() {
    if (busy || finishIntentAt || recoveryConflict) return;
    const kind = draft.pausedAt ? 'resume' : 'pause';
    const occurredAt = new Date().toISOString();
    const next = kind === 'resume'
      ? { ...draft, pausedAt: null, pausedSeconds: (draft.pausedSeconds ?? 0) + Math.max(0, Math.floor((Date.parse(occurredAt) - Date.parse(draft.pausedAt!)) / 1000)) }
      : { ...draft, pausedAt: occurredAt };
    setBusy(true);
    try {
      if (!recovery) {
        setLocalStatus('Device recovery is unavailable. Saving pause timing directly…');
        await onlineFallback.sendTiming(kind, occurredAt);
        return;
      }
      const record = await enqueueTiming(accountId, kind, occurredAt, next);
      setDraft(next);
      if (kind === 'pause') restTimer.pause(); else restTimer.resume();
      onRecoveryChange(record);
      setLocalStatus(online ? 'Pause timing saved on this device. Syncing…' : 'Pause timing saved on this device. Waiting for a connection.');
    } catch (failure) {
      if (online && isStorageFailure(failure)) {
        setBusy(false);
        await onlineFallback.sendTiming(kind, occurredAt);
        return;
      }
      setError(failure instanceof Error ? failure.message : 'Could not save pause timing on this device.');
    } finally { setBusy(false); }
  }

  async function finish() {
    const validationError = validateSessionDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    const blocker = finishBlocker(draft);
    if (blocker) { setError(blocker); return; }
    if (recoveryConflict) { setError('Resolve the workout version conflict before finishing.'); return; }
    setBusy(true);
    try {
    if (online) {
      try { await queue.whenIdle(); }
      catch (failure) {
        if (!(failure instanceof ApiError && failure.offline)) throw failure;
      }
    }
      // The program is updated first, while the dialog can still show a failure and offer to save
      // without it; the workout itself is unaffected either way.
      if (!(await planUpdate.apply())) { setBusy(false); return; }
      const finishedAt = new Date().toISOString();
      if (!recovery) {
        if (!online) throw new Error('This browser cannot save the workout locally. Reconnect before finishing.');
        setLocalStatus('Device recovery is unavailable. Finishing directly with the server…');
        const saved = await onlineFallback.finish(draft, false);
        onFinish(saved);
        return;
      }
      await enqueueSave(accountId, draft, { activeIndex });
      const withFinish = await enqueueFinish(accountId, finishedAt, false, draft);
      onRecoveryChange(withFinish);
      setFinishIntentAt(finishedAt);
      setLocalStatus(`Finished on this device at ${new Date(finishedAt).toLocaleTimeString()}. Waiting to sync.`);
      restTimer.skip();
      if (online) {
        queue.push('workout-finish', drain);
        await queue.whenIdle();
      } else {
        setBusy(false);
        setConfirm(null);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save this workout.');
      setBusy(false);
      setConfirm(null);
    }
  }

  const { swapExercise, restoreExercise, restoreWorkout } = useWorkoutExerciseList({
    accountId, draft, online, finishIntentAt, queue, revision, serverSession, drain, setDraft, onSaved, onRecoveryChange, setBusy, setError
  });

  async function discard() {
    if (!online) { setError('Reconnect before discarding this workout. Your on-device recovery copy is still saved.'); return; }
    setBusy(true);
    try {
      await queue.whenIdle();
      await api.discardWorkout(draft.id);
      restTimer.skip();
      await clearRecovery(accountId);
      onRecoveryChange(null);
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

  const paused = Boolean(draft.pausedAt);
  const done = completedSets(draft).length;
  const unit = preferences.unit;

  function selectExercise(index: number) {
    setActiveIndex(index);
    void saveNavigation(accountId, draft.id, { activeIndex: index }).catch(() => undefined);
  }

  const resolveConflict = useWorkoutConflictResolution({
    accountId, online, recovery, revision, serverSession,
    setDraft, setFinishIntentAt, setRecoveryConflict, setError, onRecoveryChange, onClose
  });

  const currentExercise = draft.exercises[activeIndex] ?? draft.exercises[0];
  const planned = plannedSets(draft);
  const canFinish = !paused && !finishIntentAt && !recoveryConflict && planned > 0 && done >= planned;
  const requestFinish = () => {
    const blocker = finishBlocker(draft);
    if (blocker) { setError(blocker); return; }
    setConfirm('finish');
  };
  const defaultRestSeconds = currentExercise?.restSeconds ?? preferences.restSeconds ?? 90;

  const { rest, handleRestMutate } = useWorkoutRest({
    accountId, draft, revision, paused, finishIntentAt, recoveryConflict, recovery, defaultRestSeconds, onRecoveryChange,
    onError: setError
  });
  const nextUp = nextUpText(draft, activeIndex, unit);
  // The Android notification shows the next set once the phone is unlocked.
  useEffect(() => { restTimer.setNextUp(draft.id, nextUp); }, [draft.id, nextUp]);

  return (
    <Modal title={draft.name} onClose={onClose} wide headless className={continues ? 'workout-sheet workout-sheet-continued' : 'workout-sheet'}>
      <WorkoutTopBar
        name={draft.name}
        syncMessage={finishIntentAt
          ? `Finished on this device at ${new Date(finishIntentAt).toLocaleTimeString()}. ${online ? 'Waiting to sync.' : 'Reconnect to save it.'}`
          : localStatus}
        online={online}
        discardDisabled={busy || !online}
        finishDisabled={busy || Boolean(finishIntentAt) || recoveryConflict}
        hasDetails={hasWorkoutDetails(draft)}
        canRestore={Boolean(draft.templateId)}
        restoreDisabled={busy || !online || paused || Boolean(finishIntentAt) || recoveryConflict}
        onRestore={() => setConfirm('restore')}
        onFinish={requestFinish}
        onDetails={() => setDetailsOpen(true)}
        onDiscard={() => setConfirm('discard')}
        session={draft}
        finishedAt={finishIntentAt}
        done={done}
        planned={planned}
        paused={paused}
        pauseDisabled={busy || Boolean(finishIntentAt) || recoveryConflict}
        onClose={onClose}
        onTogglePause={() => void togglePause()}
      />

      <WorkoutRestBar rest={rest} nextUp={nextUp}
        disabled={busy || Boolean(finishIntentAt) || recoveryConflict || paused} onRestMutate={handleRestMutate} />

      {recoveryConflict && recovery && <WorkoutRecoveryConflict recovery={recovery} online={online} onResolve={choice => void resolveConflict(choice)} />}

      <WorkoutEditor draft={draft} unit={unit} exercises={exercises} activeIndex={activeIndex} online={online}
        paused={paused} finishIntentAt={finishIntentAt} recoveryConflict={recoveryConflict}
        picker={picker} onPicker={open => { setPicker(open); if (open) loadCatalog(); }}
        onAddExercise={() => online && !paused && !finishIntentAt ? (setPicker(true), loadCatalog()) : setError('Connect and resume before adding an exercise.')}
        onChange={change} onEditSet={editSet} onToggleSet={toggle} onSelectExercise={selectExercise}
        onSwap={swapExercise} onRestore={restoreExercise} onRemoveExercise={removeExercise} onCatalogChanged={onCatalogChanged} onCatalogNeeded={onCatalogNeeded} />

      <WorkoutFooter error={error} busy={busy || Boolean(finishIntentAt) || recoveryConflict}
        celebration={celebration} canFinish={canFinish} onFinish={requestFinish} />

      {detailsOpen && <WorkoutDetailsModal draft={draft} unit={unit} onClose={() => setDetailsOpen(false)} />}

      {confirm && (
        <WorkoutConfirmModal
          confirm={confirm}
          done={done}
          unlogged={plannedSets(draft) - done}
          busy={busy}
          planUpdate={planUpdate}
          onClose={() => setConfirm(null)}
          onFinish={() => void finish()}
          onDiscard={() => void discard()}
          onRestore={() => { setConfirm(null); void restoreWorkout(); }}
        />
      )}
    </Modal>
  );
}
