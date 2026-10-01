import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api, ApiError } from './api';
import { consumeGoogleHealthHandoff } from './googleHealthBrowser';
import {IntegrationRecovery} from './integrationRecovery';

export type GoogleHealthStatus = 'disconnected' | 'connected' | 'reconnect_required';
export type GoogleHealthFreshness = 'fresh' | 'stale' | 'unavailable';
export type GoogleHealthSyncItemState = 'disabled' | 'idle' | 'pending' | 'failed' | 'unknown' | 'reconnect_required';

export interface GoogleHealthWorkoutSyncStatus {
  enabled: boolean;
  permissionGranted: boolean;
  state: GoogleHealthSyncItemState;
  pendingCount: number;
  lastSuccessfulSyncAt: string | null;
  revision: number;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export interface GoogleHealthDay {
  date: string;
  count: number | null;
}

export interface GoogleHealthSyncResult {
  status: GoogleHealthStatus;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  freshness: GoogleHealthFreshness;
  days: GoogleHealthDay[];
  warningCode?: string | null;
  warningMessage?: string | null;
  workoutSync?: GoogleHealthWorkoutSyncStatus | null;
}

export interface GoogleHealthSyncState {
  status: GoogleHealthStatus;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  freshness: GoogleHealthFreshness;
  days: GoogleHealthDay[];
  warningCode?: string | null;
  warningMessage?: string | null;
  workoutSync: GoogleHealthWorkoutSyncStatus;
}

const initialWorkoutStatus: GoogleHealthWorkoutSyncStatus = {
  enabled: false,
  permissionGranted: false,
  state: 'disabled',
  pendingCount: 0,
  lastSuccessfulSyncAt: null,
  revision: 0,
};

export const initialGoogleHealthState: GoogleHealthSyncState = {
  status: 'disconnected',
  connectedAt: null,
  lastSyncedAt: null,
  freshness: 'unavailable',
  days: [],
  workoutSync: initialWorkoutStatus,
};

// Google-derived data remains in runtime memory ONLY. Never persist to IndexedDB/localStorage.
let memoryState: GoogleHealthSyncState = initialGoogleHealthState;
let lastFetchTime = 0;
let inFlightPromise: Promise<GoogleHealthSyncState> | null = null;
let generation = 0;
let dataSyncTimer: ReturnType<typeof setTimeout> | undefined;
let dataSyncFlight: Promise<void> | null = null;
let lastDataSync = 0;
const recovery = new IntegrationRecovery();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): GoogleHealthSyncState {
  return memoryState;
}

export interface ConnectOptions {
  syncWorkout?: boolean;
}

export async function connectGoogleHealth(options: ConnectOptions = {}): Promise<{ authUrl: string }> {
  return await api.connectGoogleHealth(options);
}

export async function setGoogleHealthWorkoutSync(enabled: boolean, revision: number): Promise<GoogleHealthWorkoutSyncStatus> {
  const result = await api.setGoogleHealthWorkoutSyncPreference({ enabled, revision });
  memoryState = { ...memoryState, workoutSync: result };
  notify();
  return result;
}

export async function recoverGoogleHealthWorkoutSync(workoutSessionId?: string): Promise<GoogleHealthWorkoutSyncStatus> {
  const result = await api.recoverGoogleHealthWorkoutSync({ workoutSessionId });
  memoryState = { ...memoryState, workoutSync: result };
  notify();
  return result;
}

export async function fetchGoogleHealthStatus(force = false): Promise<GoogleHealthSyncState> {
  const now = Date.now();
  if (!force && memoryState.status === 'connected' && now - lastFetchTime < 60_000) {
    return memoryState;
  }

  if (inFlightPromise) {
    return await inFlightPromise;
  }

  const epoch = generation;
  inFlightPromise = (async () => {
    try {
      const res = await api.googleHealthStatus();
      if (epoch !== generation) throw new DOMException('Account changed', 'AbortError');
      memoryState = {
        status: res.status ?? 'disconnected',
        connectedAt: res.connectedAt ?? null,
        lastSyncedAt: res.lastSyncedAt ?? null,
        freshness: res.freshness ?? 'unavailable',
        days: res.days ?? [],
        warningCode: res.warningCode ?? null,
        warningMessage: res.warningMessage ?? null,
        workoutSync: res.workoutSync ?? initialWorkoutStatus,
      };
      lastFetchTime = Date.now();
      notify();
      recovery.reset();
      scheduleDataSync(force);
      return memoryState;
    } catch (error) {
      if (epoch === generation && listeners.size && (!(error instanceof ApiError) || [0,429,502,503,504].includes(error.status))
        && !(error instanceof DOMException && error.name === 'AbortError')) recovery.schedule(() => fetchGoogleHealthStatus(true),
          error instanceof ApiError ? error.retryAfterMs ?? 5000 : 5000);
      throw error;
    } finally {
      if (epoch === generation) inFlightPromise = null;
    }
  })();

  return await inFlightPromise;
}

export async function disconnectGoogleHealth(): Promise<void> {
  await api.disconnectGoogleHealth();
  resetGoogleHealthState();
}

export function resetGoogleHealthState() {
  generation++;
  recovery.reset();
  clearTimeout(dataSyncTimer);
  dataSyncTimer = undefined;
  dataSyncFlight = null;
  lastDataSync = 0;
  inFlightPromise = null;
  memoryState = initialGoogleHealthState;
  lastFetchTime = 0;
  notify();
}

function scheduleDataSync(force: boolean) {
  if (memoryState.status !== 'connected' || !memoryState.workoutSync.pendingCount || dataSyncFlight
    || dataSyncTimer !== undefined || (!force && Date.now() - lastDataSync < 60000)) return;
  const epoch = generation;
  dataSyncTimer = setTimeout(() => {
    dataSyncTimer = undefined;
    if (epoch !== generation) return;
    lastDataSync = Date.now();
    dataSyncFlight = api.googleHealthSyncData().then(result => {
      if (epoch !== generation || !result.workoutSync) return;
      memoryState = {...memoryState, workoutSync: result.workoutSync};
      notify();
    }).catch(() => { /* Durable uploads stay queued for a later active pass or the daily sweep. */ })
      .finally(() => { if (epoch === generation) dataSyncFlight = null; });
  }, 250);
}

export function useGoogleHealth() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [state]);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      await fetchGoogleHealthStatus(force);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update Google Health status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const resume = () => {
      if (document.visibilityState === 'visible') void refresh(consumeGoogleHealthHandoff());
    };
    const online = () => { void refresh(true); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', online);
    };
  }, [refresh]);

  return {
    state,
    loading,
    error,
    refresh,
    connect: connectGoogleHealth,
    disconnect: disconnectGoogleHealth,
  };
}
