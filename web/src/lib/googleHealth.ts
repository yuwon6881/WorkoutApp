import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api';

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

  inFlightPromise = (async () => {
    try {
      const res = await api.googleHealthStatus();
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
      return memoryState;
    } catch {
      return memoryState;
    } finally {
      inFlightPromise = null;
    }
  })();

  return await inFlightPromise;
}

export async function disconnectGoogleHealth(): Promise<void> {
  await api.disconnectGoogleHealth();
  memoryState = initialGoogleHealthState;
  lastFetchTime = 0;
  notify();
}

export function useGoogleHealth() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
