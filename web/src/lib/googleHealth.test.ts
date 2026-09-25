import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectGoogleHealth,
  disconnectGoogleHealth,
  fetchGoogleHealthStatus,
  initialGoogleHealthState,
  recoverGoogleHealthWorkoutSync,
  setGoogleHealthWorkoutSync,
} from './googleHealth';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    googleHealthStatus: vi.fn(),
    connectGoogleHealth: vi.fn(),
    disconnectGoogleHealth: vi.fn(),
    setGoogleHealthWorkoutSyncPreference: vi.fn(),
    recoverGoogleHealthWorkoutSync: vi.fn(),
  },
}));

describe('Workout Google Health lib', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
