import type { RestState } from './restTimer';
import { remainingRestSeconds } from './restTimer';

/// How long a rest that ran out stays on screen saying so, after its chime.
export const REST_OVER_MS = 2500;

export type RestPhase = 'running' | 'paused' | 'over' | 'idle';

/// What the workout header shows for the rest timer. A skipped rest goes straight to idle; one that
/// ran down to zero says so briefly. A rest that ended long ago (the sheet reopened later) is idle.
export function restPhase(rest: Pick<RestState, 'endsAt' | 'pausedRemainingMs' | 'totalSeconds'>, now: number): RestPhase {
  if (remainingRestSeconds(rest, now) > 0) return rest.endsAt === 0 ? 'paused' : 'running';
  if (rest.endsAt > 0 && now >= rest.endsAt && now - rest.endsAt < REST_OVER_MS) return 'over';
  return 'idle';
}

/// The share of the rest still to run, from 1 at the start to 0 at the end.
export function restShareLeft(rest: Pick<RestState, 'endsAt' | 'pausedRemainingMs' | 'totalSeconds'>, now: number): number {
  if (rest.totalSeconds <= 0) return 0;
  return Math.min(1, remainingRestSeconds(rest, now) / rest.totalSeconds);
}
