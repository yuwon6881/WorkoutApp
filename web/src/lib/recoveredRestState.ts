import type { SessionRest } from '../types';
import type { RestState } from './restTimer';

/** A committed recovery deadline stays absolute, including when a crash delayed its display. */
export function recoveredRestState(rest: SessionRest | null | undefined, now = Date.now()): RestState {
  const deadline = rest?.status === 'running' ? Date.parse(rest.deadlineUtc ?? '') : 0;
  const endsAt = Number.isFinite(deadline) ? deadline : 0;
  return { endsAt, pausedRemainingMs: rest?.status === 'paused' ? rest.pausedRemainingMs ?? 0 : 0,
    generation: rest?.generation ?? '', totalSeconds: (rest?.durationMs ?? 0) / 1000, announced: endsAt <= now };
}
