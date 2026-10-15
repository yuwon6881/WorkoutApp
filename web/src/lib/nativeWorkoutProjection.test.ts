import { describe, expect, it } from 'vitest';
import { nativeWorkoutState, type NativeWorkoutContext } from './nativeWorkoutProjection';
const context: NativeWorkoutContext = { sessionId: 'session', rest: { endsAt: 1000, generation: 'g', totalSeconds: 90,
  pausedRemainingMs: 0, announced: false }, clock: { startedAtMs: 1, pausedAtMs: null, pausedSeconds: 0 },
  options: { notifications: true, sound: true, vibration: false, keepAwake: false }, nextUp: { sessionId: 'other', text: 'Private other workout' } };
describe('native notification projection', () => {
  it('keeps absolute deadlines, generation, whole duration and account-session ownership', () => {
    expect(nativeWorkoutState(context)).toMatchObject({ status: 'running', deadlineMs: 1000, generation: 'g', totalMs: 90000,
      nextUp: null, alert: true, startedAtMs: 1 });
  });
  it('projects paused, idle and stopped notifications without restarting rest', () => {
    expect(nativeWorkoutState({ ...context, rest: { ...context.rest, endsAt: 0, pausedRemainingMs: 2000 } })).toMatchObject({ status: 'paused', deadlineMs: 0, pausedRemainingMs: 2000 });
    expect(nativeWorkoutState({ ...context, rest: { ...context.rest, endsAt: 0 } })).toMatchObject({ status: 'idle', totalMs: 0 });
    expect(nativeWorkoutState({ ...context, sessionId: null })).toBeNull();
  });
});
