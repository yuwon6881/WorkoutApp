import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiLaunch: vi.fn(),
  getLastAccountId: vi.fn(),
  getLastRecovery: vi.fn(),
  getRecovery: vi.fn(),
  setLastAccount: vi.fn(),
  retirePush: vi.fn()
}));
const stateHolders: { value: unknown; setter: (next: unknown) => void }[] = [];

vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
  useEffect: () => undefined,
  useSyncExternalStore: <T>(_subscribe: unknown, snapshot: () => T) => snapshot(),
  useState: <T>(initial: T) => {
    const idx = stateHolders.length;
    const holder: { value: unknown; setter: (next: unknown) => void } = {
      value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
      setter: (next: unknown) => {
        holder.value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(holder.value) : next;
      }
    };
    stateHolders[idx] = holder;
    return [holder.value as T, holder.setter as (value: T) => void];
  }
}));
vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error { signedOut = false; offline = false; },
  api: { launch: mocks.apiLaunch, unregisterRestAlertDevice: vi.fn() }
}));
vi.mock('../lib/workoutRecoveryReads', () => ({
  getLastAccountId: mocks.getLastAccountId,
  getLastRecovery: mocks.getLastRecovery,
  getRecovery: mocks.getRecovery,
  setLastAccount: mocks.setLastAccount
}));
vi.mock('../lib/push/firebaseMessaging', () => ({ getWorkoutPushDeviceId: () => null, deleteWorkoutPushToken: vi.fn() }));
vi.mock('../lib/push/cleanup', () => ({ retireWorkoutPushAfterAccountSwitch: mocks.retirePush, retireWorkoutPushDevice: vi.fn() }));
vi.mock('../lib/launchSnapshot', () => ({ readLaunchSnapshot: () => null, saveLaunchSnapshot: vi.fn(), clearLaunchSnapshot: vi.fn() }));
vi.mock('../lib/signedInDevice', () => ({ markSignedInDevice: vi.fn(), forgetSignedInDevice: vi.fn() }));
vi.mock('../lib/googleHealthAccount', () => ({ resetGoogleHealthState: vi.fn() }));
vi.mock('../lib/workoutDevicePreferences', () => ({
  defaultDevicePreferences: { sound: true, vibration: true, keepAwake: true, autoAdvance: true, supersetAdvance: true },
  loadDevicePreferences: vi.fn(async () => ({ sound: true, vibration: true, keepAwake: true, autoAdvance: true, supersetAdvance: true })),
  saveDevicePreferences: vi.fn()
}));

import { useApp } from './useApp';

function shell() {
  return {
    account: { id: 'acc-1', displayName: 'Lifter' },
    preferences: { unit: 'kg', theme: 'dark', restAlerts: false },
    activeWorkout: null, activeProgram: null, imports: [],
    nextWorkout: null, navigationCounts: { programs: 0, templates: 0 }
  };
}

function installBrowserGlobals() {
  const sessionValues = new Map<string, string>();
  const storage = {
    getItem: (key: string) => sessionValues.get(key) ?? null,
    setItem: (key: string, value: string) => { sessionValues.set(key, value); },
    removeItem: (key: string) => { sessionValues.delete(key); }
  };
  vi.stubGlobal('window', {
    location: { pathname: '/', search: '' },
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn()
  });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('location', { reload: vi.fn() });
  return { storage, reload: vi.mocked(globalThis.location.reload) };
}

function setPendingRecoveryReads() {
  mocks.apiLaunch.mockResolvedValue(shell());
  mocks.getLastAccountId.mockResolvedValue(null);
  mocks.getLastRecovery.mockImplementation(() => new Promise(() => {}));
  mocks.getRecovery.mockResolvedValue(null);
  mocks.setLastAccount.mockResolvedValue(undefined);
  mocks.retirePush.mockResolvedValue(undefined);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  stateHolders.length = 0;
});

it('times out a pending recovery read, reloads only once, and preserves the recovery state', async () => {
  vi.useFakeTimers();
  const { storage, reload } = installBrowserGlobals();
  setPendingRecoveryReads();
  const app = useApp();

  const firstLoad = app.reload();
  await vi.advanceTimersByTimeAsync(10_001);
  await firstLoad;

  expect(reload).toHaveBeenCalledOnce();
  expect(mocks.setLastAccount).not.toHaveBeenCalled();
  expect(app.recovery).toBeNull();
  expect(stateHolders[2].value).toBe(false);

  const retry = app.reload();
  await vi.advanceTimersByTimeAsync(10_001);
  await retry;

  expect(reload).toHaveBeenCalledOnce();
  expect(storage.getItem('workout-startup-reload')).toBe('1');
  expect(stateHolders[2].value).toBe(false);
  expect(stateHolders[3].value).toMatch(/saved workout recovery/i);
  expect(mocks.setLastAccount).not.toHaveBeenCalled();

  mocks.getLastRecovery.mockResolvedValue(null);
  await app.reload();

  expect(storage.getItem('workout-startup-reload')).toBeNull();
  expect(stateHolders[3].value).toBe('');
});