import type { RestState, RestTimerOptions, WorkoutClock } from './restTimer';
import type { NativeWorkoutState } from './nativeBridge';

export type NativeWorkoutContext = {
  sessionId: string | null; rest: RestState; clock: WorkoutClock | null; options: RestTimerOptions;
  nextUp: { sessionId: string; text: string | null } | null;
};
export function nativeWorkoutState({ sessionId, rest, clock, options, nextUp }: NativeWorkoutContext): NativeWorkoutState | null {
  if (!sessionId) return null;
  const running = rest.endsAt > 0;
  const paused = !running && rest.pausedRemainingMs > 0;
  return { sessionId, generation: rest.generation, status: running ? 'running' : paused ? 'paused' : 'idle',
    deadlineMs: running ? rest.endsAt : 0, pausedRemainingMs: paused ? rest.pausedRemainingMs : 0,
    startedAtMs: clock?.startedAtMs ?? null, pausedAtMs: clock?.pausedAtMs ?? null, pausedSeconds: clock?.pausedSeconds ?? 0,
    alert: options.notifications, sound: options.sound, vibrate: options.vibration,
    totalMs: running || paused ? rest.totalSeconds * 1000 : 0, nextUp: nextUp?.sessionId === sessionId ? nextUp.text : null };
}
