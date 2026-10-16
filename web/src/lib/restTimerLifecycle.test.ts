import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const alarm = vi.hoisted(() => ({
  cancelAlarm: vi.fn(),
  primeAlarm: vi.fn(),
  releaseAlarm: vi.fn(),
  scheduleAlarm: vi.fn(),
  soundNow: vi.fn(),
  testAlarmSound: vi.fn()
}));

vi.mock('./alarm', () => alarm);

import { RestTimer } from './restTimer';

describe('rest timer wake lock lifecycle', () => {
  let release: ReturnType<typeof vi.fn>;
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T08:00:00.000Z'));
    release = vi.fn(async () => undefined);
    request = vi.fn(async () => ({ release, addEventListener: vi.fn() } as unknown as WakeLockSentinel));
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('navigator', { wakeLock: { request } });
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() { return store.size; },
      key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { store.set(key, String(value)); }),
      removeItem: vi.fn((key: string) => { store.delete(key); })
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('acquires when enabled during an idle workout and keeps the lock after rest ends', async () => {
    const timer = new RestTimer();
    timer.setScope('account-1', 'workout-1', { notifications: false, sound: false, vibration: false, keepAwake: false });
    timer.setWorkoutVisible(true);
    timer.setOptions({ notifications: false, sound: false, vibration: false, keepAwake: true });
    await Promise.resolve();

    expect(request).toHaveBeenCalledOnce();
    timer.start(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(release).not.toHaveBeenCalled();

    timer.setWorkoutVisible(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it('scoping account A to session 2 removes A session-1 key but keeps account B key', () => {
    const timerA = new RestTimer();
    timerA.setScope('account-a', 'session-1');
    timerA.start(60);

    const timerB = new RestTimer();
    timerB.setScope('account-b', 'session-1');
    timerB.start(60);

    expect(localStorage.getItem('workout.rest.v2:account-a:session-1')).not.toBeNull();
    expect(localStorage.getItem('workout.rest.v2:account-b:session-1')).not.toBeNull();

    timerA.setScope('account-a', 'session-2');

    expect(localStorage.getItem('workout.rest.v2:account-a:session-1')).toBeNull();
    expect(localStorage.getItem('workout.rest.v2:account-b:session-1')).not.toBeNull();
  });

  it('scoping A/session1 -> (A, null) -> A/session1 keeps a running rest for session 1', () => {
    const timer = new RestTimer();
    timer.setScope('account-a', 'session-1');
    timer.start(60);

    expect(timer.remainingMs).toBe(60_000);
    expect(localStorage.getItem('workout.rest.v2:account-a:session-1')).not.toBeNull();

    vi.advanceTimersByTime(10_000);
    expect(timer.remainingMs).toBe(50_000);

    timer.setScope('account-a', null);
    expect(timer.remainingMs).toBe(0);
    expect(localStorage.getItem('workout.rest.v2:account-a:session-1')).not.toBeNull();

    vi.advanceTimersByTime(10_000);

    timer.setScope('account-a', 'session-1');
    expect(timer.remainingMs).toBe(40_000);
    expect(timer.current.totalSeconds).toBe(60);
    expect(localStorage.getItem('workout.rest.v2:account-a:session-1')).not.toBeNull();
  });
});
