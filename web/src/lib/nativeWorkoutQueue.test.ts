import { afterEach, expect, it, vi } from 'vitest';
import type { NativeWorkoutContext } from './nativeWorkoutProjection';
const native = vi.hoisted(() => ({ nativeSyncWorkoutContext: vi.fn() }));
vi.mock('./nativeBridge', () => native);
import { syncNativeWorkout } from './platform';
afterEach(() => vi.unstubAllGlobals());
it('captures native state and serializes delivery even when the first bridge write fails', async () => {
  vi.stubGlobal('Capacitor', { isNativePlatform: () => true, isPluginAvailable: () => true });
  const context: NativeWorkoutContext = { sessionId: 'session', rest: { endsAt: 1000, generation: 'one', totalSeconds: 90,
    pausedRemainingMs: 0, announced: false }, clock: null, options: { notifications: true, sound: true, vibration: false, keepAwake: false }, nextUp: null };
  let rejectFirst!: (reason: Error) => void;
  native.nativeSyncWorkoutContext.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
    .mockResolvedValue(undefined);
  syncNativeWorkout(context);
  context.rest.generation = 'two';
  syncNativeWorkout(context);
  await vi.waitFor(() => expect(native.nativeSyncWorkoutContext).toHaveBeenCalledOnce());
  expect(native.nativeSyncWorkoutContext.mock.calls[0][0].rest.generation).toBe('one');
  rejectFirst(new Error('bridge restarted'));
  await vi.waitFor(() => expect(native.nativeSyncWorkoutContext).toHaveBeenCalledTimes(2));
  expect(native.nativeSyncWorkoutContext.mock.calls[1][0].rest.generation).toBe('two');
});
