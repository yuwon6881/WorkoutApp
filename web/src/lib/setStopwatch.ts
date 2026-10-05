import { useSyncExternalStore } from 'react';
import { stopwatchSeconds } from './setDuration';

export type RunningStopwatch = {
  startedAtMs: number;
  baseSeconds: number;
  /** Seconds a countdown runs to; null counts up until stopped. */
  targetSeconds: number | null;
  /** Set when a countdown reached its target and is waiting to be written into the set. */
  finishedSeconds?: number;
  pausedAtMs?: number;
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
  if (!entry || entry.pausedAtMs !== undefined || entry.targetSeconds === null || entry.finishedSeconds !== undefined) return;
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
  return entry.finishedSeconds ?? stopwatchSeconds(entry.baseSeconds, entry.startedAtMs, entry.pausedAtMs ?? nowMs, entry.targetSeconds);
}

/** Forgets a stopwatch without recording it, for a set that is removed or edited by hand. */
export function discardStopwatch(setId: string) {
  clearDeadline(setId);
  if (running.delete(setId)) emit();
}

export function clearStopwatches() {
  for (const setId of running.keys()) clearDeadline(setId);
  running.clear();
  emit();
}

export function pauseStopwatches(nowMs = Date.now()) {
  let changed = false;
  for (const [id, entry] of running) {
    if (entry.pausedAtMs !== undefined || entry.finishedSeconds !== undefined) continue;
    clearDeadline(id);
    running.set(id, { ...entry, pausedAtMs: nowMs });
    changed = true;
  }
  if (changed) emit();
}

export function resumeStopwatches(nowMs = Date.now()) {
  let changed = false;
  for (const [id, entry] of running) {
    if (entry.pausedAtMs === undefined) continue;
    const next = { ...entry, startedAtMs: entry.startedAtMs + Math.max(0, nowMs - entry.pausedAtMs) };
    delete next.pausedAtMs;
    running.set(id, next);
    if (next.targetSeconds !== null && next.finishedSeconds === undefined) {
      const remaining = (next.targetSeconds - next.baseSeconds) * 1000 - (nowMs - next.startedAtMs);
      deadlines.set(id, setTimeout(() => finishCountdown(id), Math.max(0, remaining)));
    }
    changed = true;
  }
  if (changed) emit();
}

export function useStopwatch(setId: string): RunningStopwatch | undefined {
  return useSyncExternalStore(subscribe, () => running.get(setId), () => undefined);
}

/** Every running stopwatch, for keeping a copy with the workout's device recovery. */
export function runningStopwatches(): Record<string, RunningStopwatch> {
  return Object.fromEntries(running);
}

export function subscribeStopwatches(listener: () => void): () => void {
  return subscribe(listener);
}

/**
 * Picks up stopwatches saved before the app was closed or crashed. A hold keeps its wall-clock
 * start, so it reads as though it never stopped; a countdown whose target passed meanwhile is
 * finished quietly (the chime would only confuse on reopening) and waits to be logged.
 */
export function restoreStopwatches(saved: Record<string, RunningStopwatch>, nowMs = Date.now()) {
  let restored = false;
  for (const [setId, entry] of Object.entries(saved)) {
    if (running.has(setId) || !Number.isFinite(entry?.startedAtMs) || !Number.isFinite(entry?.baseSeconds)) continue;
    const target = typeof entry.targetSeconds === 'number' ? entry.targetSeconds : null;
    const next: RunningStopwatch = { startedAtMs: entry.startedAtMs, baseSeconds: entry.baseSeconds, targetSeconds: target };
    if (typeof entry.pausedAtMs === 'number') next.pausedAtMs = entry.pausedAtMs;
    if (typeof entry.finishedSeconds === 'number') next.finishedSeconds = entry.finishedSeconds;
    if (target !== null && next.finishedSeconds === undefined && next.pausedAtMs === undefined) {
      const remainingMs = (target - entry.baseSeconds) * 1000 - (nowMs - entry.startedAtMs);
      if (remainingMs <= 0) next.finishedSeconds = target;
      else deadlines.set(setId, setTimeout(() => finishCountdown(setId), remainingMs));
    }
    running.set(setId, next);
    restored = true;
  }
  if (restored) emit();
}
