import { useCallback, useEffect, useRef, useState } from 'react';
import type { Exercise, LoggedSet, Preferences, Session } from '../types';
import { ApiError, api } from '../lib/api';
import type { SaveQueue } from '../lib/queue';
import { completedSets, plannedSets } from '../lib/training';
import { structuralChanges } from '../lib/workoutDraft';
import { validateLoggedSet, validateSessionDraft } from '../lib/validation';
import { restTimer } from '../lib/restTimer';
import {
  clearRecovery, enqueueFinish, enqueueSave, enqueueSetEdits, enqueueTiming, getRecovery,
  keepLocalWorkout, persistDraftOnly, saveNavigation,
  startRecovery, useServerWorkout
} from '../lib/workoutRecovery';
import { startRestAfterSetIsDurable, workoutServerBaseline } from '../lib/workoutRecoveryActions';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import { drainWorkoutOutbox, sessionPayload } from '../lib/workoutOutbox';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { WorkoutFooter } from './WorkoutFooter';
import { WorkoutTopBar } from './WorkoutTopBar';
import { WorkoutEditor } from './WorkoutEditor';
import { WorkoutRecoveryConflict } from './WorkoutRecoveryConflict';
import { useWorkoutOnlineFallback } from './useWorkoutOnlineFallback';

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
  onDiscard
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
}) {
  const [draft, setDraft] = useState(recovery?.sessionId === session.id ? recovery.draft : session);
  const [now, setNow] = useState(Date.now());
  const [rest, setRest] = useState(restTimer.current);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState<'finish' | 'discard' | null>(null);
  const [retainSwaps, setRetainSwaps] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewMode, setViewMode] = useState<'focus' | 'all'>(recovery?.viewMode ?? 'focus');
  const [activeIndex, setActiveIndex] = useState(() => recovery?.activeIndex ?? (() => {
    const firstUnfinished = session.exercises.findIndex(e => e.sets.some(s => !s.done));
    return firstUnfinished >= 0 ? firstUnfinished : 0;
  })());
  const [finishIntentAt, setFinishIntentAt] = useState(() => recovery?.operations.find(operation => operation.type === 'finish')?.finishedAt ?? null);
  const [localStatus, setLocalStatus] = useState('');
  const [recoveryConflict, setRecoveryConflict] = useState(recovery?.conflict ?? false);

  const serverSession = useRef(recovery?.serverSession ?? session);
  const revision = useRef(serverSession.current.revision);
  const setToggleGenerations = useRef(new Map<string, number>());
  const onlineFallback = useWorkoutOnlineFallback({
    sessionId: session.id, accountId, online, queue, preferences, recovery, revision,
    serverSession, onSaved, onRecoveryChange, setDraft, setBusy, setError, setLocalStatus
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // The timer outlives this component: minimizing does not cancel a rest deadline. Its record is
  // separately scoped to this account and workout by the app shell.
  useEffect(() => {
    restTimer.setWorkoutVisible(true);
    const unsubscribe = restTimer.subscribe(setRest);
    return () => { unsubscribe(); restTimer.setWorkoutVisible(false); };
  }, []);

  useEffect(() => {
    if (recovery) {
      serverSession.current = recovery.serverSession;
      revision.current = recovery.serverSession.revision;
      setRecoveryConflict(recovery.conflict);
      const pendingFinish = recovery.operations.find(operation => operation.type === 'finish');
      setFinishIntentAt(pendingFinish?.type === 'finish' ? pendingFinish.finishedAt : null);
      setDraft(recovery.draft);
      setActiveIndex(recovery.activeIndex);
      setViewMode(recovery.viewMode);
      return;
    }
    void startRecovery({
      accountId, displayName: '', sessionId: session.id, draft: session, serverSession: session,
      preferences, activeIndex, viewMode
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

  async function change(next: Session, changedSet?: { setId: string; patch: Partial<LoggedSet> }): Promise<boolean> {
    if (finishIntentAt) { setError('This workout is finished on this device and is waiting to sync.'); return false; }
    if (onlineFallback.hasPendingFinish()) { setError('A finish request needs confirmation. Retry the same finish before making more changes.'); return false; }
    if (!online && structuralChanges(draft, next)) {
      setError('Adding, removing, or replacing exercises needs a connection. Set logging and notes are saved on this device.');
      return false;
    }
    setDraft(next);
    const validationError = validateSessionDraft(next);
    if (validationError) {
      setError(validationError);
      try { onRecoveryChange(await persistDraftOnly(accountId, next, { activeIndex, viewMode })); }
      catch { setLocalStatus('This unfinished edit could not be saved on the device.'); }
      return false;
    }
    setError('');
    setLocalStatus('Saving on this device…');
    const persist = changedSet
      ? enqueueSetEdits(accountId, next, { activeIndex, viewMode })
      : enqueueSave(accountId, next, { activeIndex, viewMode });
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
            setLocalStatus('Saved to the server. Device recovery is unavailable on this browser.');
          });
          await queue.whenIdle();
          return true;
        } catch (fallbackFailure) {
          setError(fallbackFailure instanceof Error ? fallbackFailure.message : 'Could not save this workout to the server.');
          return false;
        }
      }
      setError(failure instanceof Error ? failure.message : 'Could not save this workout on the device.');
      return false;
    }
  }

  async function editSet(ei: number, si: number, patch: Partial<LoggedSet>): Promise<boolean> {
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
    return change(next, { setId: exercise.sets[si].id, patch });
  }

  async function toggle(ei: number, si: number) {
    const set = draft.exercises[ei].sets[si];
    if (!set.done) {
      const validationError = validateLoggedSet({ ...set, done: true });
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setError('');
    const setGeneration = setToggleGenerations.current;
    const generation = (setGeneration.get(set.id) ?? 0) + 1;
    setGeneration.set(set.id, generation);
    const persist = () => editSet(ei, si, { done: !set.done });
    const plan = draft.exercises[ei].prescription[si];
    const seconds = plan?.restSeconds;
    if (!set.done && seconds && seconds > 0 && !draft.pausedAt) {
      const restSeconds = seconds;
      restTimer.primeSound();
      await startRestAfterSetIsDurable(persist, () => {
        if (setGeneration.get(set.id) === generation) restTimer.start(restSeconds);
      });
    } else await persist();
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
    if (!done) {
      setError('Complete at least one working set before finishing.');
      return;
    }
    if (recoveryConflict) { setError('Resolve the workout version conflict before finishing.'); return; }
    setBusy(true);
    try {
    if (online) {
      try { await queue.whenIdle(); }
      catch (failure) {
        if (!(failure instanceof ApiError && failure.offline)) throw failure;
      }
    }
      const finishedAt = new Date().toISOString();
      if (!recovery) {
        if (!online) throw new Error('This browser cannot save the workout locally. Reconnect before finishing.');
        setLocalStatus('Device recovery is unavailable. Finishing directly with the server…');
        const saved = await onlineFallback.finish(draft, retainSwaps);
        onFinish(saved);
        return;
      }
      await enqueueSave(accountId, draft, { activeIndex, viewMode });
      const withFinish = await enqueueFinish(accountId, finishedAt, retainSwaps, draft);
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

  async function swapExercise(sessionExerciseId: string, replacementExerciseId: string | null, replacementName: string) {
    if (!online || finishIntentAt || draft.pausedAt) { setError('Connect and resume the workout before changing its exercise list.'); return; }
    setBusy(true); setError('');
    try {
      await queue.push(`workout-swap-${sessionExerciseId}`, async () => {
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
    if (!online || finishIntentAt || draft.pausedAt) { setError('Connect and resume the workout before changing its exercise list.'); return; }
    setBusy(true); setError('');
    try {
      await queue.push(`workout-restore-${sessionExerciseId}`, async () => {
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
  const elapsedAt = finishIntentAt ? Date.parse(finishIntentAt) : draft.pausedAt ? Date.parse(draft.pausedAt) : now;
  const openPauseSeconds = draft.pausedAt ? Math.max(0, Math.floor((elapsedAt - Date.parse(draft.pausedAt)) / 1000)) : 0;
  const elapsed = Math.max(0, Math.floor((elapsedAt - Date.parse(draft.startedAt)) / 1000) - (draft.pausedSeconds ?? 0) - openPauseSeconds);
  const remaining = rest.endsAt === 0 ? Math.max(0, Math.ceil(rest.pausedRemainingMs / 1000)) : Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
  const done = completedSets(draft).length;
  const unit = preferences.unit;

  function selectExercise(index: number) {
    setActiveIndex(index);
    const nextView = viewMode === 'all' ? 'focus' : viewMode;
    if (nextView !== viewMode) setViewMode(nextView);
    void saveNavigation(accountId, draft.id, { activeIndex: index, viewMode: nextView }).catch(() => undefined);
  }

  function selectViewMode(next: 'focus' | 'all') {
    setViewMode(next);
    void saveNavigation(accountId, draft.id, { activeIndex, viewMode: next }).catch(() => undefined);
  }

  async function resolveConflict(choice: 'server' | 'local') {
    if (!recovery) return;
    try {
      if (choice === 'server') {
        if (!recovery.serverSession.active) {
          await clearRecovery(accountId);
          setFinishIntentAt(null);
          setRecoveryConflict(false);
          onRecoveryChange(null);
          restTimer.skip();
          onClose();
          return;
        }
        const next = await useServerWorkout(accountId, recovery.serverSession);
        setDraft(recovery.serverSession);
        serverSession.current = recovery.serverSession;
        revision.current = recovery.serverSession.revision;
        setFinishIntentAt(null);
        setRecoveryConflict(false); onRecoveryChange(next); setError('');
      } else {
        if (!online) { setError('Reconnect before applying the on-device version.'); return; }
        if (!recovery.serverSession.active) { setError('This workout is already finished on the server. Use the server copy to return to training.'); return; }
        const next = await keepLocalWorkout(accountId, recovery.serverSession);
        const baseline = workoutServerBaseline(next.serverSession);
        serverSession.current = baseline.session;
        revision.current = baseline.revision;
        setFinishIntentAt(next.operations.find(operation => operation.type === 'finish')?.finishedAt ?? null);
        setRecoveryConflict(false); onRecoveryChange(next); setError('');
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not resolve this workout conflict.'); }
  }

  const currentExercise = draft.exercises[activeIndex] ?? draft.exercises[0];
  const uncompletedSetIndex = currentExercise ? currentExercise.sets.findIndex(s => !s.done) : -1;
  const currentPrescription = currentExercise ? currentExercise.prescription[uncompletedSetIndex >= 0 ? uncompletedSetIndex : 0] : undefined;
  const defaultRestSeconds = currentPrescription?.restSeconds ?? currentExercise?.prescription[0]?.restSeconds ?? 90;

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
        onToggleViewMode={() => selectViewMode(viewMode === 'focus' ? 'all' : 'focus')}
      />

      {recoveryConflict && recovery && <WorkoutRecoveryConflict recovery={recovery} online={online} onResolve={choice => void resolveConflict(choice)} />}

      {finishIntentAt && <div className="device-status" role="status">
        Finished on this device at {new Date(finishIntentAt).toLocaleTimeString()}. {online ? 'Waiting to sync.' : 'Reconnect to save it.'}
      </div>}
      {localStatus && !finishIntentAt && <div className="device-status" role="status">{localStatus}</div>}

      <WorkoutEditor draft={draft} unit={unit} exercises={exercises} activeIndex={activeIndex} viewMode={viewMode} online={online}
        paused={paused} finishIntentAt={finishIntentAt} recoveryConflict={recoveryConflict} busy={busy} error={error}
        picker={picker} onPicker={setPicker}
        onAddExercise={() => online && !paused && !finishIntentAt ? setPicker(true) : setError('Connect and resume before adding an exercise.')}
        onChange={change} onEditSet={editSet} onToggleSet={toggle} onSelectExercise={selectExercise} onTogglePause={togglePause}
        onSwap={swapExercise} onRestore={restoreExercise} onRemoveExercise={removeExercise} />

      <WorkoutFooter remaining={remaining} totalSeconds={rest.totalSeconds}
        restEndedAt={rest.announced && rest.endsAt > 0 ? rest.endsAt : null} defaultRestSeconds={defaultRestSeconds}
        busy={busy || Boolean(finishIntentAt) || recoveryConflict} restDisabled={paused || Boolean(finishIntentAt) || recoveryConflict}
        onDiscard={() => setConfirm('discard')} onMinimize={onClose}
        onFinish={() => {
          if (!done) { setError('Complete at least one working set before finishing.'); return; }
          setConfirm('finish');
        }} />

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

function isStorageFailure(failure: unknown): boolean {
  return failure instanceof Error && /device|storage|quota|indexeddb|transaction/i.test(failure.message);
}
