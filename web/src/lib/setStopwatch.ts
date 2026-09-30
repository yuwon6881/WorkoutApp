import { useSyncExternalStore } from 'react';
import { stopwatchSeconds } from './setDuration';

export type RunningStopwatch = {
  startedAtMs: number;
  baseSeconds: number;
  /** Seconds a countdown runs to; null counts up until stopped. */
  targetSeconds: number | null;
  /** Set when a countdown reached its target and is waiting to be written into the set. */
  finishedSeconds?: number;
};

// Held in memory by set id so a hold keeps counting while the user swipes to another exercise
// (which unmounts the row). Only the stopped value is a set edit; it is saved like any other.
const running = new Map<string, RunningStopwatch>();
const deadlines = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let onFinished: () => void = () => {};

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function clearDeadline(setId: string) {
  const deadline = deadlines.get(setId);
  if (deadline !== undefined) clearTimeout(deadline);
  deadlines.delete(setId);
}

/** How a finished countdown is announced; the workout wires in its chime and vibration. */
export function setStopwatchAnnouncer(announce: () => void) {
  onFinished = announce;
}

/**
 * Starts the set's stopwatch. With a target it counts down and finishes itself at the target; an
 * earlier partial hold continues, while a set already at its target starts a fresh attempt.
 * Without a target it counts up from the time already entered until it is stopped.
 */
export function startStopwatch(setId: string, baseSeconds: number | null | undefined, targetSeconds: number | null = null, nowMs = Date.now()) {
  clearDeadline(setId);
  const base = targetSeconds !== null && (baseSeconds ?? 0) >= targetSeconds ? 0 : baseSeconds ?? 0;
  running.set(setId, { startedAtMs: nowMs, baseSeconds: base, targetSeconds });
  if (targetSeconds !== null) {
    deadlines.set(setId, setTimeout(() => finishCountdown(setId), (targetSeconds - base) * 1000));
  }
  emit();
}

export function finishCountdown(setId: string) {
  const entry = running.get(setId);
  clearDeadline(setId);
  if (!entry || entry.targetSeconds === null || entry.finishedSeconds !== undefined) return;
  running.set(setId, { ...entry, finishedSeconds: entry.targetSeconds });
  emit();
  onFinished();
}

/** Stops the set's stopwatch and returns the seconds reached, or null when none was running. */
export function stopStopwatch(setId: string, nowMs = Date.now()): number | null {
  const entry = running.get(setId);
  if (!entry) return null;
  running.delete(setId);
  clearDeadline(setId);
  emit();
  return entry.finishedSeconds ?? stopwatchSeconds(entry.baseSeconds, entry.startedAtMs, nowMs, entry.targetSeconds);
}

/** Forgets a stopwatch without recording it, for a set that is removed or edited by hand. */
export function discardStopwatch(setId: string) {
  clearDeadline(setId);
  if (running.delete(setId)) emit();
}

export function useStopwatch(setId: string): RunningStopwatch | undefined {
  return useSyncExternalStore(subscribe, () => running.get(setId), () => undefined);
}
