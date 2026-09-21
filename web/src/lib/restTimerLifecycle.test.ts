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
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
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
});
