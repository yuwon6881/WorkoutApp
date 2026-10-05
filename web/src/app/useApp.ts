import {resetGoogleHealthState} from '../lib/googleHealthAccount';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { sharedReads } from '../lib/readCoordinator';
import { SaveQueue } from '../lib/queue';
import type { QueueStatus } from '../lib/queue';
import type { AppResource, Bootstrap, Preferences, Session } from '../types';
import { deleteWorkoutPushToken, getWorkoutPushDeviceId } from '../lib/push/firebaseMessaging';
import { retireWorkoutPushAfterAccountSwitch, retireWorkoutPushDevice } from '../lib/push/cleanup';
import { clearRecovery, defaultDevicePreferences, getLastAccountId, getLastRecovery, getRecovery, loadDevicePreferences, refreshRecovery, sameWorkoutEdits, saveDevicePreferences as persistDevicePreferences, setConflict, setLastAccount, startRecovery } from '../lib/workoutRecovery';
import type { DevicePreferences, WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import { clearStopwatches } from '../lib/setStopwatch';
import { forgetSessionDetail } from '../lib/sessionDetailLoad';

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
  ensureResources: (resources: AppResource[], throwOnError?: boolean) => Promise<void>;
  resourceError: string;
  queue: SaveQueue;
  setData: (update: (current: Bootstrap) => Bootstrap) => void;
  /** Shows the preferences at once; settles when the save has reached the server or failed. */
  savePreferences: (preferences: Preferences) => Promise<void>;
  setActiveWorkout: (session: Session | null) => void;
  setRecovery: (record: WorkoutRecoveryRecord | null) => void;
  setDevicePreferences: (preferences: DevicePreferences) => Promise<void>;
  preferencePending: boolean;
  retryPreferences: () => Promise<void>;
  revertPreferences: () => void;
  isAccountCurrent: (id: string) => boolean;
  signOut: () => Promise<void>;
};

/// Server data remains authoritative. The only training record retained on this device is the
/// account-scoped active workout recovery snapshot and its durable mutation identities.
export function useApp(): AppState {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // A failed sign-in callback already establishes the destination, even while the session
  // check is pending. Integration-consent callbacks in Settings keep their authenticated flow.
  const [signedOut, setSignedOut] = useState(() => window.location.pathname === '/' &&
    Boolean(new URLSearchParams(window.location.search).get('central_error')));
  const [online, setOnline] = useState(() => navigator.onLine);
  const [recovery, setRecovery] = useState<WorkoutRecoveryRecord | null>(null);
  const [devicePreferences, setDevicePreferencesState] = useState<DevicePreferences>(defaultDevicePreferences);
  const queue = useMemo(() => new SaveQueue(), []);
  const [status, setStatus] = useState<QueueStatus>(queue.current);
  const pendingPreferences = useRef<{ accountId: string; desired: Preferences; confirmed: Preferences } | null>(null);
  const [preferencePending, setPreferencePending] = useState(false);
  const wasOnline = useRef(online);
  const lastRefreshAt = useRef(0);
  const currentData = useRef(data);
  currentData.current = data;
  const reloadFlight = useRef<Promise<void> | null>(null);
  const loadEpoch = useRef(0);
  const mutationAccount = useRef<string | null>(null);
  const isAccountCurrent = useCallback((id: string) => mutationAccount.current === id, []);
  const preferenceVersion = useRef(0);
  const devicePreferenceVersion = useRef(0);
  const workoutVersion = useRef(0);
  const resourcesInFlight = useRef(new Map<AppResource, Promise<void>>());
  const [resourceError, setResourceError] = useState('');

  useEffect(() => queue.subscribe(next => {
    setStatus(next);
    if (next.state === 'signed-out') {
      mutationAccount.current = null;
      clearStopwatches(); forgetSessionDetail(); pendingPreferences.current = null; setPreferencePending(false);
      void retireCurrentPushDevice();
      void setLastAccount(null).catch(() => undefined);
      setRecovery(null);
      loadEpoch.current++; sharedReads.reset(); resourcesInFlight.current.clear();
      setSignedOut(true);
      setData(null);
    }
  }), [queue]);

  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    const preferenceAtStart = preferenceVersion.current;
    // A read that starts while a preference save is queued or in flight can carry the previous
    // preferences, so it must not replace the ones on screen.
    const preferenceSavingAtStart = queue.pending('preferences');
    const workoutAtStart = workoutVersion.current;
    resourcesInFlight.current.clear();
    setLoading(true);
    if (!currentData.current && !queue.unsaved) queue.set('connecting');
    let validatedAccountId: string | null | undefined;
    const cachedRecovery = (currentData.current ? Promise.resolve(null) : getLastRecovery()).then(async local => {
      if (!local) return;
      const preferences = await loadDevicePreferences(local.accountId);
      if (epoch !== loadEpoch.current || currentData.current || workoutVersion.current !== workoutAtStart
          || validatedAccountId !== undefined && validatedAccountId !== local.accountId) return;
      setDevicePreferencesState(preferences);
      if (validatedAccountId === undefined) mutationAccount.current = local.accountId;
      setRecovery(local);
    }).catch(() => undefined);
    try {
      const [previousAccountId, shell] = await Promise.all([getLastAccountId().catch(() => null), api.launch()]);
      if (epoch !== loadEpoch.current) return;
      validatedAccountId = shell.account.id;
      if (mutationAccount.current !== null && mutationAccount.current !== shell.account.id) queue.clear();
      mutationAccount.current = shell.account.id;
      const next: Bootstrap = { ...shell, exercises: [], templates: [], programs: [],
        history: { total: 0, page: 0, size: 20, sessions: [] }, resources: {}, historyDeferred: true };
      const previous = currentData.current;
      if (previousAccountId && previousAccountId !== next.account.id) setRecovery(null);
      if (previous?.account.id === next.account.id) {
        if (previous.resourceVersions?.history && previous.resourceVersions.history === next.resourceVersions?.history) {
          next.history = previous.history;
          next.progress = previous.progress;
        }
        next.exercises = previous.exercises; next.programs = previous.programs; next.templates = previous.templates;
        next.loadedResources = Object.fromEntries((['catalog', 'programs', 'templates'] as const)
          .map(resource => [resource, previous.resources?.[resource] || previous.loadedResources?.[resource]]));
        for (const resource of ['catalog', 'programs', 'templates'] as const) {
          if (previous.resources?.[resource] && previous.resourceVersions?.[resource] === next.resourceVersions?.[resource]) {
            if (resource === 'catalog') next.exercises = previous.exercises;
            else if (resource === 'programs') next.programs = previous.programs;
            else next.templates = previous.templates;
            next.resources![resource] = true;
          }
        }
      }
      if (previousAccountId && previousAccountId !== next.account.id) sharedReads.reset();
      const deviceId = getWorkoutPushDeviceId();
      await retireWorkoutPushAfterAccountSwitch(previousAccountId, next.account.id, deviceId,
        deviceId ? () => api.unregisterRestAlertDevice(deviceId) : undefined, deleteWorkoutPushToken);
      await cachedRecovery;
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
          if (!sameWorkoutEdits(local.draft, local.serverSession)) {
            local = await setConflict(next.account.id, true, next.activeWorkout) ?? local;
          } else {
            local = await refreshRecovery(next.account.id, next.account.displayName, next.activeWorkout, next.preferences) ?? local;
          }
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
        if (!sameWorkoutEdits(local.draft, local.serverSession) || local.operations.length > 0) {
          const previous = await api.getWorkout(local.sessionId).catch(() => null);
          local = await setConflict(next.account.id, true, previous ?? local.serverSession) ?? local;
        } else {
          await clearRecovery(next.account.id).catch(() => undefined);
          local = null;
        }
      } else if (next.activeWorkout) {
        try {
          await startRecovery({
            accountId: next.account.id, displayName: next.account.displayName, sessionId: next.activeWorkout.id,
            draft: next.activeWorkout, serverSession: next.activeWorkout, preferences: next.preferences,
            activeIndex: 0
          });
          local = await getRecovery(next.account.id);
        } catch { local = null; /* storage failure must not block online training */ }
      }
      const devicePreferences = await loadDevicePreferences(next.account.id);
      if (epoch !== loadEpoch.current) return;
      if (workoutVersion.current === workoutAtStart) setRecovery(local);
      setDevicePreferencesState(devicePreferences);
      const current = currentData.current;
      if (current?.account.id === next.account.id) {
        if (preferenceVersion.current !== preferenceAtStart || preferenceSavingAtStart || pendingPreferences.current?.accountId === next.account.id) next.preferences = current.preferences;
        if (workoutVersion.current !== workoutAtStart) next.activeWorkout = current.activeWorkout;
      }
      lastRefreshAt.current = Date.now();
      if (currentData.current?.account.id !== next.account.id) {
        if (previousAccountId && previousAccountId !== next.account.id) clearStopwatches();
        forgetSessionDetail(); pendingPreferences.current = null; setPreferencePending(false);
        queue.clear(); resetGoogleHealthState();
      }
      setData(next); setResourceError(''); setError(''); setSignedOut(false);
      if (!queue.unsaved) queue.clear();
    } catch (failure) {
      if (epoch !== loadEpoch.current) return;
      const problem = failure instanceof ApiError ? failure : new ApiError('Could not load your training.', -1);
      if (problem.signedOut) mutationAccount.current = null;
      if (problem.signedOut) { clearStopwatches(); forgetSessionDetail(); pendingPreferences.current = null; setPreferencePending(false); validatedAccountId = null; resetGoogleHealthState(); await setLastAccount(null).catch(() => undefined); setRecovery(null); setSignedOut(true); setData(null); setError(''); queue.clear(); queue.set('signed-out'); }
      else {
        setError(problem.message);
        if (problem.offline) {
          try {
            const local = await getLastRecovery();
            setRecovery(local);
            if (local) mutationAccount.current = local.accountId;
            if (local) setDevicePreferencesState(await loadDevicePreferences(local.accountId));
          } catch { setRecovery(null); }
        }
        queue.set(problem.offline ? 'offline' : 'failed', problem.message);
      }
    } finally { if (epoch === loadEpoch.current) setLoading(false); }
  }, [queue]);

  const reload = useCallback(() => {
    if (reloadFlight.current) return reloadFlight.current;
    const flight = load().finally(() => { if (reloadFlight.current === flight) reloadFlight.current = null; });
    reloadFlight.current = flight;
    return flight;
  }, [load]);

  const ensureResources = useCallback(async (requested: AppResource[], throwOnError = false) => {
    const accountId = currentData.current?.account.id;
    const epoch = loadEpoch.current;
    if (!accountId) return;
    setResourceError('');
    try {
      await Promise.all(requested.map(resource => {
        if (currentData.current?.resources?.[resource]) return;
        const existing = resourcesInFlight.current.get(resource);
        if (existing) return existing;
        const flight = (async () => {
          const value = resource === 'catalog' ? await api.exercises()
            : resource === 'programs' ? await api.programs() : await api.templates();
          if (epoch !== loadEpoch.current || currentData.current?.account.id !== accountId) return;
          setData(current => current?.account.id === accountId ? { ...current,
            [resource === 'catalog' ? 'exercises' : resource]: value,
            resources: { ...current.resources, [resource]: true } } : current);
        })().finally(() => { if (resourcesInFlight.current.get(resource) === flight) resourcesInFlight.current.delete(resource); });
        resourcesInFlight.current.set(resource, flight);
        return flight;
      }));
    } catch (failure) {
      if (epoch === loadEpoch.current) setResourceError(failure instanceof Error ? failure.message : 'This view could not be loaded.');
      if (throwOnError) throw failure;
    }
  }, []);

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

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState === 'visible' && navigator.onLine && currentData.current
          && !queue.unsaved && Date.now() - lastRefreshAt.current >= 30_000) void reload();
      }, 250);
    };
    window.addEventListener('online', schedule);
    window.addEventListener('workout:resume', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', schedule);
      window.removeEventListener('workout:resume', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [queue, reload]);

  // Leaving with work still queued would lose it: there is no local copy to come back to.
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (queue.unsaved) event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [queue]);

  const patch = useCallback((update: (current: Bootstrap) => Bootstrap) =>
    setData(current => current ? update(current) : current), []);

  const savePreferences = useCallback((preferences: Preferences) => {
    const current = currentData.current;
    if (!current) return Promise.reject(new Error('Sign in before saving preferences.'));
    const previous = pendingPreferences.current?.accountId === current.account.id ? pendingPreferences.current.confirmed : current.preferences;
    pendingPreferences.current = { accountId: current.account.id, desired: preferences, confirmed: previous };
    setPreferencePending(true);
    preferenceVersion.current++;
    patch(current => ({ ...current, preferences }));
    const version = preferenceVersion.current;
    const accountId = currentData.current?.account.id;
    queue.push('preferences', async () => {
      if (mutationAccount.current !== accountId) return;
      const saved = await api.preferences(preferences);
      if (mutationAccount.current !== accountId || currentData.current?.account.id !== accountId) return;
      const pending = pendingPreferences.current;
      if (pending && pending.accountId === accountId) pending.confirmed = saved;
      if (preferenceVersion.current === version) {
        pendingPreferences.current = null; setPreferencePending(false);
        patch(current => ({ ...current, preferences: saved }));
      }
    });
    return queue.whenIdle();
  }, [patch, queue]);

  const retryPreferences = useCallback(async () => {
    const pending = pendingPreferences.current;
    if (pending && pending.accountId === currentData.current?.account.id) await savePreferences(pending.desired);
  }, [savePreferences]);
  const revertPreferences = useCallback(() => {
    const pending = pendingPreferences.current;
    if (!pending || queue.pending('preferences')) return;
    preferenceVersion.current++;
    if (pending.accountId === currentData.current?.account.id) patch(current => ({ ...current, preferences: pending.confirmed }));
    pendingPreferences.current = null; setPreferencePending(false); queue.dismissFailure('preferences');
  }, [patch, queue]);

  const setActiveWorkout = useCallback((session: Session | null) => {
    workoutVersion.current++;
    patch(current => ({ ...current, activeWorkout: session?.active ? session : null }));
  }, [patch]);

  const updateRecovery = useCallback((record: WorkoutRecoveryRecord | null) => {
    workoutVersion.current++;
    setRecovery(record);
  }, []);

  const setDevicePreferences = useCallback(async (preferences: DevicePreferences) => {
    const version = ++devicePreferenceVersion.current;
    setDevicePreferencesState(preferences);
    const accountId = data?.account.id ?? recovery?.accountId;
    if (accountId) {
      try { await persistDevicePreferences(accountId, preferences); }
      catch (failure) {
        if (version === devicePreferenceVersion.current && currentData.current?.account.id === accountId)
          setDevicePreferencesState(devicePreferences);
        throw failure;
      }
    }
  }, [data?.account.id, recovery?.accountId, devicePreferences]);

  const signOut = useCallback(async () => {
    loadEpoch.current++; sharedReads.reset(); resourcesInFlight.current.clear();
    await retireCurrentPushDevice();
    await api.logout();
    mutationAccount.current = null;
    clearStopwatches(); forgetSessionDetail(); pendingPreferences.current = null; setPreferencePending(false);
    resetGoogleHealthState(); await setLastAccount(null).catch(() => undefined); queue.clear(); setData(null); setRecovery(null); setSignedOut(true);
  }, [queue]);

  return { data, status, loading, error, signedOut, online, recovery, devicePreferences, reload, ensureResources, resourceError, queue, setData: patch, savePreferences, setActiveWorkout, setRecovery: updateRecovery, setDevicePreferences, signOut, preferencePending, retryPreferences, revertPreferences, isAccountCurrent };
}

async function retireCurrentPushDevice(): Promise<void> {
  const deviceId = getWorkoutPushDeviceId();
  await retireWorkoutPushDevice(deviceId, deviceId ? () => api.unregisterRestAlertDevice(deviceId) : undefined, deleteWorkoutPushToken);
}
