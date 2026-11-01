import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../types';
import type { WorkoutRecoveryRecord } from '../lib/workoutRecovery';
import type { FinishPlanUpdate } from './useFinishPlanUpdate';

const mocks = vi.hoisted(() => ({
  haptic: vi.fn(),
  finishBlocker: vi.fn((): string | null => null),
  validateSessionDraft: vi.fn((): string | null => null),
  enqueueSave: vi.fn(async () => ({})),
  enqueueFinish: vi.fn(async () => ({ operations: [] }))
}));

vi.mock('../lib/platform', () => ({ haptic: mocks.haptic }));
vi.mock('../lib/training', () => ({ finishBlocker: mocks.finishBlocker }));
vi.mock('../lib/validation', () => ({ validateSessionDraft: mocks.validateSessionDraft }));
vi.mock('../lib/finishedSetTimers', () => ({ withFinishedSetTimers: (draft: Session) => draft }));
vi.mock('../lib/setStopwatch', () => ({ clearStopwatches: vi.fn() }));
vi.mock('../lib/restTimer', () => ({ restTimer: { skip: vi.fn() } }));
vi.mock('../lib/workoutRecovery', () => ({ enqueueSave: mocks.enqueueSave, enqueueFinish: mocks.enqueueFinish }));

const { useWorkoutFinish } = await import('./useWorkoutFinish');

function setup(overrides: { online?: boolean; recoveryConflict?: boolean } = {}) {
  const calls = {
    setError: vi.fn(),
    setConfirm: vi.fn(),
    setBusy: vi.fn(),
    setFinishIntentAt: vi.fn(),
    onFinish: vi.fn()
  };
  const finishing = useWorkoutFinish({
    accountId: 'account-1',
    draft: { id: 'session-1', exercises: [] } as unknown as Session,
    activeIndex: 0,
    online: overrides.online ?? false,
    queue: { whenIdle: async () => undefined, push: vi.fn() } as never,
    recovery: { operations: [] } as unknown as WorkoutRecoveryRecord,
    recoveryConflict: overrides.recoveryConflict ?? false,
    planUpdate: { apply: async () => true, input: undefined } as unknown as FinishPlanUpdate,
    onlineFallback: {} as never,
    drain: async () => undefined,
    onFinish: calls.onFinish,
    onRecoveryChange: vi.fn(),
    setBusy: calls.setBusy,
    setConfirm: calls.setConfirm,
    setError: calls.setError,
    setFinishIntentAt: calls.setFinishIntentAt,
    setLocalStatus: vi.fn()
  });
  return { ...finishing, calls };
}

describe('useWorkoutFinish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.finishBlocker.mockReturnValue(null);
    mocks.validateSessionDraft.mockReturnValue(null);
  });

  it('opens the confirmation when nothing blocks the finish', () => {
    const { requestFinish, calls } = setup();
    requestFinish();
    expect(calls.setConfirm).toHaveBeenCalledWith('finish');
    expect(mocks.haptic).not.toHaveBeenCalled();
  });

  it('buzzes a warning with the message when the finish is refused', () => {
    mocks.finishBlocker.mockReturnValue('Log or remove set 2 first.');
    const { requestFinish, calls } = setup();
    requestFinish();
    expect(calls.setError).toHaveBeenCalledWith('Log or remove set 2 first.');
    expect(calls.setConfirm).not.toHaveBeenCalled();
    expect(mocks.haptic).toHaveBeenCalledWith('warning');
  });

  it('refuses a finish during a version conflict without saving anything', async () => {
    const { finish, calls } = setup({ recoveryConflict: true });
    await finish();
    expect(calls.setError).toHaveBeenCalledWith('Resolve the workout version conflict before finishing.');
    expect(mocks.enqueueFinish).not.toHaveBeenCalled();
    expect(mocks.haptic).toHaveBeenCalledWith('warning');
  });

  it('confirms success once the finish is recorded on the device', async () => {
    const { finish, calls } = setup({ online: false });
    await finish();
    expect(mocks.enqueueSave).toHaveBeenCalledBefore(mocks.enqueueFinish);
    expect(calls.setFinishIntentAt).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledExactlyOnceWith('success');
    expect(calls.setConfirm).toHaveBeenCalledWith(null);
  });

  it('gives no success when recording the finish fails', async () => {
    mocks.enqueueFinish.mockRejectedValueOnce(new Error('Device storage is full.'));
    const { finish, calls } = setup({ online: false });
    await finish();
    expect(calls.setFinishIntentAt).not.toHaveBeenCalled();
    expect(calls.setError).toHaveBeenCalledWith('Device storage is full.');
    expect(mocks.haptic).toHaveBeenCalledExactlyOnceWith('warning');
  });
});
