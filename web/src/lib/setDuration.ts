import type { LoggedSet, SessionExercise, SetPrescription, Unit } from '../types';
import { showClock, showReps, showWeight } from './training';

/** Mirrors the API's Validation.MaxSetSeconds: a single timed set lasts at most two hours. */
export const MAX_SET_SECONDS = 7200;

export const isTimedExercise = (exercise: Pick<SessionExercise, 'trackingMode'>): boolean =>
  exercise.trackingMode === 'duration';

/** "0:45", "2:30". A missing time stays missing rather than reading as zero. */
export const showSetDuration = (seconds: number | null | undefined): string =>
  seconds == null ? '—' : showClock(seconds);

/** A logged timed set for history lists: "0:45", or "20 kg · 0:45" when it was weighted. */
export function showTimedSet(set: Pick<LoggedSet, 'weightKg' | 'durationSeconds'>, unit: Unit): string {
  const time = showSetDuration(set.durationSeconds);
  return set.weightKg === null ? time : `${showWeight(set.weightKg, unit)} · ${time}`;
}

/**
 * A timed exercise's target: printed text ("30–45 sec") verbatim, otherwise the plan's number read
 * as seconds, since a timed exercise has no reps for it to mean. No target stays a dash.
 */
export function showTimedTarget(plan: SetPrescription): string {
  if (plan.repsText?.trim()) return plan.repsText;
  const target = showReps(plan);
  return target === '—' ? target : `${target} s`;
}

// The same printed shapes the import keeps as a duration ("45 sec", "0:45", "30–45 s hold"), plus a
// bare number or range, which on a timed exercise means seconds. A bare "m" is metres, never minutes.
const DURATION_TEXT = /^(?:[~≈]\s*)?(?:(\d{1,2})?:(\d{2})|(\d+(?:\.\d+)?)(?:\s*(?:[-–]|to)\s*(\d+(?:\.\d+)?))?\s*[- ]?\s*(s|secs?|seconds?|mins?|minutes?)?)(?:\s+(?:hold|each(?:\s+side)?|per\s+(?:leg|side)))?$/i;

/**
 * Seconds the set's countdown runs to: the top of a printed or typed range, or null when the plan
 * states no time, in which case the stopwatch counts up until it is stopped.
 */
export function timedTargetSeconds(plan: SetPrescription | undefined): number | null {
  if (!plan) return null;
  const text = plan.repsText?.trim();
  let seconds: number | null = plan.repMax ?? plan.repMin;
  if (text) {
    const match = DURATION_TEXT.exec(text);
    if (!match) return null;
    const [, clockMinutes, clockSeconds, low, high, unit] = match;
    seconds = clockSeconds !== undefined
      ? Number(clockMinutes ?? 0) * 60 + Number(clockSeconds)
      : Number(high ?? low) * (/^min/i.test(unit ?? '') ? 60 : 1);
  }
  if (seconds === null) return null;
  const whole = Math.round(seconds);
  return whole >= 1 && whole <= MAX_SET_SECONDS ? whole : null;
}

/** Whole seconds a running stopwatch has reached, capped at its target or what can be saved. */
export function stopwatchSeconds(baseSeconds: number, startedAtMs: number, nowMs: number, targetSeconds: number | null = null): number {
  const elapsed = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  return Math.min(targetSeconds ?? MAX_SET_SECONDS, baseSeconds + elapsed);
}
