import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { SaveQueue } from '../lib/queue';
import type { QueueStatus } from '../lib/queue';
import type { Bootstrap, Preferences, Session } from '../types';
import { deleteWorkoutPushToken, getWorkoutPushDeviceId } from '../lib/push/firebaseMessaging';
import { retireWorkoutPushAfterAccountSwitch, retireWorkoutPushDevice } from '../lib/push/cleanup';
import { defaultDevicePreferences, getLastAccountId, getLastRecovery, getRecovery, loadDevicePreferences, refreshRecovery, sameWorkoutEdits, saveDevicePreferences as persistDevicePreferences, setConflict, setLastAccount, startRecovery } from '../lib/workoutRecovery';
import type { DevicePreferences, WorkoutRecoveryRecord } from '../lib/workoutRecovery';

export type AppState = {
  data: Bootstrap | null;
  status: QueueStatus;
  loading: boolean;
  error: string;
  signedOut: boolean;
  online: boolean;
  recovery: WorkoutRecoveryRecord | null;
  devicePreferences: DevicePreferences;
  reload: () => Promise<void>;
  queue: SaveQueue;
  setData: (update: (current: Bootstrap) => Bootstrap) => void;
  savePreferences: (preferences: Preferences) => void;
  setActiveWorkout: (session: Session | null) => void;
  setRecovery: (record: WorkoutRecoveryRecord | null) => void;
  setDevicePreferences: (preferences: DevicePreferences) => void;
  signOut: () => Promise<void>;
};

/// Server data remains authoritative. The only training record retained on this device is the
/// account-scoped active workout recovery snapshot and its durable mutation identities.
export function useApp(): AppState {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signedOut, setSignedOut] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [recovery, setRecovery] = useState<WorkoutRecoveryRecord | null>(null);
  const [devicePreferences, setDevicePreferencesState] = useState<DevicePreferences>(defaultDevicePreferences);
  const queue = useMemo(() => new SaveQueue(), []);
  const [status, setStatus] = useState<QueueStatus>(queue.current);
  const wasOnline = useRef(online);

  useEffect(() => queue.subscribe(next => {
    setStatus(next);
    if (next.state === 'signed-out') {
      void retireCurrentPushDevice();
      void setLastAccount(null).catch(() => undefined);
      setRecovery(null);
      setSignedOut(true);
      setData(null);
    }
  }), [queue]);

  const reload = useCallback(async () => {
    setLoading(true);
    queue.set('connecting');
    try {
      const previousAccountId = await getLastAccountId().catch(() => null);
      const next = await api.bootstrap();
      const deviceId = getWorkoutPushDeviceId();
      await retireWorkoutPushAfterAccountSwitch(previousAccountId, next.account.id, deviceId,
        deviceId ? () => api.unregisterRestAlertDevice(deviceId) : undefined, deleteWorkoutPushToken);
      let local: WorkoutRecoveryRecord | null = null;
      try {
        await setLastAccount(next.account.id);
        local = await getRecovery(next.account.id);
      } catch { /* local recovery is optional for reading server-backed training */ }
      if (local && next.activeWorkout?.id === local.sessionId) {
        const hasPending = local.operations.length > 0;
        const operationWasSent = local.operations[0]?.revision !== null && local.operations[0] !== undefined;
        if (hasPending && !operationWasSent && local.serverSession.revision !== next.activeWorkout.revision && !sameWorkoutEdits(local.serverSession, next.activeWorkout)) {
          local = await setConflict(next.account.id, true, next.activeWorkout) ?? local;
        } else if (!hasPending && !sameWorkoutEdits(local.draft, next.activeWorkout) && local.serverSession.revision !== next.activeWorkout.revision) {
          local = await setConflict(next.account.id, true, next.activeWorkout) ?? local;
        } else if (sameWorkoutEdits(local.draft, next.activeWorkout)) {
          local = await refreshRecovery(next.account.id, next.account.displayName, next.activeWorkout, next.preferences) ?? local;
        } else if (!operationWasSent && sameWorkoutEdits(local.serverSession, next.activeWorkout)) {
          local = await setConflict(next.account.id, false, next.activeWorkout) ?? local;
        }
      } else if (local && !next.activeWorkout?.active && local.operations.some(operation => operation.type === 'finish')) {
        // A prior finish may have reached the API before the browser closed. Replay its exact
        // mutation identity after the UI mounts; the server acknowledges an exact retry.
      } else if (local && next.activeWorkout && local.sessionId !== next.activeWorkout.id && local.operations.length > 0) {
        const previous = await api.getWorkout(local.sessionId).catch(() => null);
        local = await setConflict(next.account.id, true, previous ?? undefined) ?? local;
      } else if (local && next.activeWorkout && local.sessionId !== next.activeWorkout.id && !sameWorkoutEdits(local.draft, local.serverSession)) {
        const previous = await api.getWorkout(local.sessionId).catch(() => null);
        local = await setConflict(next.account.id, true, previous ?? undefined) ?? local;
      } else if (local && !next.activeWorkout?.active && !local.operations.some(operation => operation.type === 'finish')) {
        const previous = await api.getWorkout(local.sessionId).catch(() => null);
        local = await setConflict(next.account.id, true, previous ?? local.serverSession) ?? local;
      } else if (next.activeWorkout) {
        try {
          await startRecovery({
            accountId: next.account.id, displayName: next.account.displayName, sessionId: next.activeWorkout.id,
            draft: next.activeWorkout, serverSession: next.activeWorkout, preferences: next.preferences,
            activeIndex: 0, viewMode: 'focus'
          });
          local = await getRecovery(next.account.id);
        } catch { local = null; /* storage failure must not block online training */ }
      }
      setRecovery(local);
      setDevicePreferencesState(await loadDevicePreferences(next.account.id));
      setData(next); setError(''); setSignedOut(false);
      queue.clear();
    } catch (failure) {
      const problem = failure instanceof ApiError ? failure : new ApiError('Could not load your training.', -1);
      if (problem.signedOut) { await setLastAccount(null).catch(() => undefined); setRecovery(null); setSignedOut(true); setData(null); setError(''); queue.set('signed-out'); }
      else {
        setError(problem.message);
        if (problem.offline) {
          try {
            const local = await getLastRecovery();
            setRecovery(local);
            if (local) setDevicePreferencesState(await loadDevicePreferences(local.accountId));
          } catch { setRecovery(null); }
        }
        queue.set(problem.offline ? 'offline' : 'failed', problem.message);
      }
    } finally { setLoading(false); }
  }, [queue]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => {
    const returnedOnline = online && !wasOnline.current;
    wasOnline.current = online;
    if (returnedOnline && !data && !signedOut && !loading) void reload();
  }, [online, data, signedOut, loading, reload]);

  // Leaving with work still queued would lose it: there is no local copy to come back to.
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (queue.unsaved) event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [queue]);

  const patch = useCallback((update: (current: Bootstrap) => Bootstrap) =>
    setData(current => current ? update(current) : current), []);

  const savePreferences = useCallback((preferences: Preferences) => {
    patch(current => ({ ...current, preferences }));
    queue.push('preferences', async () => {
      const saved = await api.preferences(preferences);
      patch(current => ({ ...current, preferences: saved }));
    });
  }, [patch, queue]);

  const setActiveWorkout = useCallback((session: Session | null) =>
    patch(current => ({ ...current, activeWorkout: session?.active ? session : null })), [patch]);

  const setDevicePreferences = useCallback((preferences: DevicePreferences) => {
    setDevicePreferencesState(preferences);
    const accountId = data?.account.id ?? recovery?.accountId;
    if (accountId) void persistDevicePreferences(accountId, preferences);
  }, [data?.account.id, recovery?.accountId]);

  const signOut = useCallback(async () => {
    await retireCurrentPushDevice();
    try { await api.logout(); } finally { await setLastAccount(null).catch(() => undefined); queue.clear(); setData(null); setRecovery(null); setSignedOut(true); }
  }, [queue]);

  return { data, status, loading, error, signedOut, online, recovery, devicePreferences, reload, queue, setData: patch, savePreferences, setActiveWorkout, setRecovery, setDevicePreferences, signOut };
}

async function retireCurrentPushDevice(): Promise<void> {
  const deviceId = getWorkoutPushDeviceId();
  await retireWorkoutPushDevice(deviceId, deviceId ? () => api.unregisterRestAlertDevice(deviceId) : undefined, deleteWorkoutPushToken);
}
