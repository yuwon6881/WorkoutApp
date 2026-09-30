import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoggedSet, SetPrescription } from '../types';
import { MAX_SET_SECONDS, showSetDuration, showTimedSet, showTimedTarget, stopwatchSeconds, timedTargetSeconds } from './setDuration';
import { discardStopwatch, setStopwatchAnnouncer, startStopwatch, stopStopwatch } from './setStopwatch';
import { validateLoggedSet } from './validation';

const plan = (patch: Partial<SetPrescription>) => ({ repMin: null, repMax: null, repsText: null, ...patch }) as SetPrescription;
const logged = (patch: Partial<LoggedSet>): LoggedSet =>
  ({ id: 'set', position: 0, weightKg: null, reps: null, rpe: null, done: false, warmup: false, ...patch });

describe('timed sets', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('reads the countdown target from printed or typed prescriptions', () => {
    expect(timedTargetSeconds(plan({ repsText: '45 sec' }))).toBe(45);
    expect(timedTargetSeconds(plan({ repsText: '45s hold' }))).toBe(45);
    expect(timedTargetSeconds(plan({ repsText: '0:45' }))).toBe(45);
    expect(timedTargetSeconds(plan({ repsText: '1:30' }))).toBe(90);
    expect(timedTargetSeconds(plan({ repsText: '1 min' }))).toBe(60);
    expect(timedTargetSeconds(plan({ repsText: '30–45 sec each side' }))).toBe(45);
    expect(timedTargetSeconds(plan({ repsText: '~60 seconds' }))).toBe(60);
    expect(timedTargetSeconds(plan({ repMin: 45, repMax: 45 }))).toBe(45);
    expect(timedTargetSeconds(plan({ repMin: 30, repMax: 60 }))).toBe(60);
  });

  it('has no target when the plan states no time, so the stopwatch counts up', () => {
    expect(timedTargetSeconds(plan({}))).toBeNull();
    expect(timedTargetSeconds(undefined)).toBeNull();
    expect(timedTargetSeconds(plan({ repsText: 'AMRAP' }))).toBeNull();
    expect(timedTargetSeconds(plan({ repsText: '20 m' }))).toBeNull();
    expect(stopwatchSeconds(0, 0, 10_000_000)).toBe(MAX_SET_SECONDS);
  });

  it('a countdown finishes itself at the target, announces once, and records the target', () => {
    vi.useFakeTimers();
    const announce = vi.fn();
    setStopwatchAnnouncer(announce);
    startStopwatch('c', null, 45, Date.now());
    vi.advanceTimersByTime(44_000);
    expect(announce).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(stopStopwatch('c')).toBe(45);
  });

  it('a stopped countdown keeps the partial hold, a restart continues it, and a full set starts over', () => {
    vi.useFakeTimers();
    const announce = vi.fn();
    setStopwatchAnnouncer(announce);
    startStopwatch('d', null, 45, 0);
    expect(stopStopwatch('d', 30_000)).toBe(30);
    startStopwatch('d', 30, 45, Date.now());
    vi.advanceTimersByTime(15_000);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(stopStopwatch('d')).toBe(45);
    startStopwatch('e', 45, 45, 0);
    expect(stopStopwatch('e', 10_000)).toBe(10);
    discardStopwatch('e');
  });

  it('formats a logged time and keeps a missing time missing', () => {
    expect(showSetDuration(45)).toBe('0:45');
    expect(showSetDuration(150)).toBe('2:30');
    expect(showSetDuration(null)).toBe('—');
    expect(showTimedSet({ weightKg: null, durationSeconds: 60 }, 'kg')).toBe('1:00');
    expect(showTimedSet({ weightKg: 20, durationSeconds: 60 }, 'kg')).toContain('1:00');
  });

  it('shows printed target text verbatim and otherwise reads the number as seconds', () => {
    expect(showTimedTarget(plan({ repsText: '30–45 sec' }))).toBe('30–45 sec');
    expect(showTimedTarget(plan({ repMin: 30, repMax: 45 }))).toBe('30–45 s');
    expect(showTimedTarget(plan({}))).toBe('—');
  });

  it('counts whole seconds from where the set left off and caps at the save limit', () => {
    expect(stopwatchSeconds(0, 1_000, 1_999)).toBe(0);
    expect(stopwatchSeconds(20, 1_000, 11_500)).toBe(30);
    expect(stopwatchSeconds(0, 5_000, 1_000)).toBe(0);
    expect(stopwatchSeconds(MAX_SET_SECONDS - 1, 0, 60_000)).toBe(MAX_SET_SECONDS);
  });

  it('stops once and returns the time reached, and a discarded stopwatch records nothing', () => {
    startStopwatch('a', 10, null, 0);
    expect(stopStopwatch('a', 5_000)).toBe(15);
    expect(stopStopwatch('a', 9_000)).toBeNull();
    startStopwatch('b', null, null, 0);
    discardStopwatch('b');
    expect(stopStopwatch('b', 9_000)).toBeNull();
  });

  it('accepts a completed set with a time instead of reps and rejects an out-of-range time', () => {
    expect(validateLoggedSet(logged({ done: true, durationSeconds: 45 }))).toBeUndefined();
    expect(validateLoggedSet(logged({ durationSeconds: 0 }))).toBeDefined();
    expect(validateLoggedSet(logged({ durationSeconds: MAX_SET_SECONDS + 1 }))).toBeDefined();
  });
});
