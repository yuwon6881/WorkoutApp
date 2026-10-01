import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectGoogleHealth,
  disconnectGoogleHealth,
  fetchGoogleHealthStatus,
  initialGoogleHealthState,
  recoverGoogleHealthWorkoutSync,
  resetGoogleHealthState,
  setGoogleHealthWorkoutSync,
} from './googleHealth';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    googleHealthStatus: vi.fn(),
    googleHealthSyncData: vi.fn(),
    connectGoogleHealth: vi.fn(),
    disconnectGoogleHealth: vi.fn(),
    setGoogleHealthWorkoutSyncPreference: vi.fn(),
    recoverGoogleHealthWorkoutSync: vi.fn(),
  },
}));

describe('Workout Google Health lib', () => {
  beforeEach(() => {
    resetGoogleHealthState();
    vi.clearAllMocks();
  });
  afterEach(() => { resetGoogleHealthState(); vi.useRealTimers(); });

  it('ignores a late response from an account that was reset', async () => {
    let finishOld!: (value: typeof initialGoogleHealthState) => void;
    vi.mocked(api.googleHealthStatus).mockReturnValueOnce(new Promise(resolve => {finishOld = resolve;}));
    const old = fetchGoogleHealthStatus(true);
    const rejected = expect(old).rejects.toMatchObject({name: 'AbortError'});
    resetGoogleHealthState();
    const current = {...initialGoogleHealthState, status: 'connected' as const, freshness: 'fresh' as const,
      days: [{date: '2026-10-01', count: 9876}]};
    vi.mocked(api.googleHealthStatus).mockResolvedValueOnce(current);
    await fetchGoogleHealthStatus(true);
    finishOld({...current, days: [{date: '2026-10-01', count: 1234}]});
    await rejected;
    expect((await fetchGoogleHealthStatus()).days[0].count).toBe(9876);
  });

  it('does not wait for uploads before returning connection status', async () => {
    vi.useFakeTimers();
    const saved = {...initialGoogleHealthState, status: 'connected' as const,
      workoutSync: {...initialGoogleHealthState.workoutSync, pendingCount: 1}};
    vi.mocked(api.googleHealthStatus).mockResolvedValueOnce(saved);
    let finish!: (state: typeof saved) => void;
    vi.mocked(api.googleHealthSyncData).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    expect((await fetchGoogleHealthStatus()).status).toBe('connected');
    await vi.advanceTimersByTimeAsync(250);
    expect(api.googleHealthSyncData).toHaveBeenCalledTimes(1);
    expect((await fetchGoogleHealthStatus()).status).toBe('connected');
    finish(saved);
    await vi.advanceTimersByTimeAsync(1);
  });

  it('has valid initial disconnected state', () => {
    expect(initialGoogleHealthState.status).toBe('disconnected');
    expect(initialGoogleHealthState.workoutSync.enabled).toBe(false);
    expect(initialGoogleHealthState.workoutSync.state).toBe('disabled');
  });

  it('calls connectGoogleHealth with options', async () => {
    vi.mocked(api.connectGoogleHealth).mockResolvedValueOnce({ authUrl: 'https://accounts.google.com/test' });

    const result = await connectGoogleHealth({ syncWorkout: true });
    expect(api.connectGoogleHealth).toHaveBeenCalledWith({ syncWorkout: true });
    expect(result.authUrl).toBe('https://accounts.google.com/test');
  });

  it('fetches status and updates state', async () => {
    vi.mocked(api.googleHealthStatus).mockResolvedValueOnce({
      status: 'connected',
      connectedAt: '2026-09-20T10:00:00Z',
      lastSyncedAt: '2026-09-20T10:05:00Z',
      freshness: 'fresh',
      days: [{ date: '2026-09-20', count: 8500 }],
      workoutSync: {
        enabled: true,
        permissionGranted: true,
        state: 'idle',
        pendingCount: 0,
        lastSuccessfulSyncAt: '2026-09-20T10:05:00Z',
        revision: 1,
        failureCode: null,
        failureMessage: null,
      },
    });

    const state = await fetchGoogleHealthStatus(true);
    expect(state.status).toBe('connected');
    expect(state.workoutSync.enabled).toBe(true);
    expect(state.days).toHaveLength(1);
    expect(state.days[0].count).toBe(8500);
  });

  it('reports status request failures to the caller', async () => {
    vi.mocked(api.googleHealthStatus).mockRejectedValueOnce(new Error('Service unavailable'));

    await expect(fetchGoogleHealthStatus(true)).rejects.toThrow('Service unavailable');
  });

  it('sets workout sync preference and updates state', async () => {
    vi.mocked(api.setGoogleHealthWorkoutSyncPreference).mockResolvedValueOnce({
      enabled: true,
      permissionGranted: true,
      state: 'pending',
      pendingCount: 1,
      lastSuccessfulSyncAt: null,
      revision: 2,
    });

    const result = await setGoogleHealthWorkoutSync(true, 1);
    expect(api.setGoogleHealthWorkoutSyncPreference).toHaveBeenCalledWith({ enabled: true, revision: 1 });
    expect(result.enabled).toBe(true);
    expect(result.pendingCount).toBe(1);
  });

  it('recovers workout sync', async () => {
    vi.mocked(api.recoverGoogleHealthWorkoutSync).mockResolvedValueOnce({
      enabled: true,
      permissionGranted: true,
      state: 'pending',
      pendingCount: 1,
      lastSuccessfulSyncAt: null,
      revision: 2,
    });

    const result = await recoverGoogleHealthWorkoutSync('session-123');
    expect(api.recoverGoogleHealthWorkoutSync).toHaveBeenCalledWith({ workoutSessionId: 'session-123' });
    expect(result.state).toBe('pending');
  });

  it('resets state upon disconnect', async () => {
    vi.mocked(api.disconnectGoogleHealth).mockResolvedValueOnce({
      status: 'disconnected',
      connectedAt: null,
      lastSyncedAt: null,
      freshness: 'unavailable',
      days: [],
      workoutSync: null,
    });

    await disconnectGoogleHealth();
    expect(api.disconnectGoogleHealth).toHaveBeenCalled();
  });
});
