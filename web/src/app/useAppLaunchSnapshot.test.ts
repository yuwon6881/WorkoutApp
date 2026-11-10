import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Session, ShellBootstrap } from '../types';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import { readLaunchSnapshot, saveLaunchSnapshot } from '../lib/launchSnapshot';

const storage = new Map<string, string>();
const { originalWindowDescriptor, originalNavigatorDescriptor, originalLocalStorageDescriptor } = vi.hoisted(() => {
  const origWinDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const origLsDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  if (typeof globalThis.window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { pathname: '/', search: '' }, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true },
      writable: true,
      configurable: true
    });
  }
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, writable: true, configurable: true });
  }
  return { originalWindowDescriptor: origWinDesc, originalNavigatorDescriptor: origNavDesc, originalLocalStorageDescriptor: origLsDesc };
});

const stateHolders: { value: unknown; setter: (v: unknown) => void }[] = [];
let stateIndex = 0;

vi.mock('react', () => ({
  useRef: <T>(current: T) => ({ current }),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
  useEffect: () => undefined,
  useSyncExternalStore: <T>(_subscribe: unknown, snapshot: () => T) => snapshot(),
  useState: <T>(initial: T) => {
    const idx = stateIndex++;
    if (!stateHolders[idx]) {
      const holder: { value: unknown; setter: (next: unknown) => void } = {
        value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        setter: (next: unknown) => {
          holder.value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(holder.value) : next;
        }
      };
      stateHolders[idx] = holder;
    }
    return [stateHolders[idx].value as T, stateHolders[idx].setter as (val: T) => void];
  }
}));

import { useApp } from './useApp';

function shell(): ShellBootstrap {
  return {
    account: { id: 'acc-1', displayName: 'Lifter' },
    preferences: { unit: 'kg', theme: 'dark', restAlerts: false },
    activeWorkout: null, activeProgram: null, imports: [],
    nextWorkout: null, navigationCounts: { programs: 0, templates: 0 }
  };
}

function initAppWithSnapshot() {
  stateHolders.length = 0;
  stateIndex = 0;
  return useApp();
}

afterEach(() => {
  storage.clear();
  stateHolders.length = 0;
  stateIndex = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(() => {
  if (originalWindowDescriptor === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  if (originalNavigatorDescriptor === undefined) delete (globalThis as { navigator?: unknown }).navigator;
  else Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  if (originalLocalStorageDescriptor === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
  else Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
});

describe('useApp launch snapshot clearing on active workout', () => {
  it('removes the remembered pre-workout snapshot when an active workout or recovery is set', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); }
    });

    saveLaunchSnapshot(shell(), Date.now(), 'v');
    expect(readLaunchSnapshot()).not.toBeNull();
    const app = initAppWithSnapshot();
    const session = {
      id: 's-1', name: 'Push', revision: 1, active: true, startedAt: '2026-10-27T10:00:00Z',
      finishedAt: null, pausedAt: null, pausedMilliseconds: 0, note: '', exercises: [],
      rest: null, volumeKg: null, systemVolumeKg: null
    } as unknown as Session;

    app.setActiveWorkout(session);
    expect(readLaunchSnapshot()).toBeNull();

    saveLaunchSnapshot(shell(), Date.now(), 'v');
    expect(readLaunchSnapshot()).not.toBeNull();
    const record: WorkoutRecoveryRecord = {
      schemaVersion: 1, accountId: 'acc-1', displayName: 'Lifter', sessionId: 's-1',
      draft: session, serverSession: session, preferences: { unit: 'kg', theme: 'dark', restAlerts: false },
      activeIndex: 0, operations: [], conflict: false, updatedAt: '2026-10-27T10:00:00Z'
    };

    app.setRecovery(record);
    expect(readLaunchSnapshot()).toBeNull();
  });
});
