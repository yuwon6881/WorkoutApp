import { afterEach, describe, expect, it, vi } from 'vitest';
import { discardStopwatch, restoreStopwatches, runningStopwatches, startStopwatch, stopStopwatch } from './setStopwatch';

const start = Date.parse('2026-10-04T08:00:00.000Z');

afterEach(() => {
  for (const setId of Object.keys(runningStopwatches())) discardStopwatch(setId);
  vi.useRealTimers();
});

describe('stopwatch recovery', () => {
  it('lists running stopwatches so the workout can keep a copy', () => {
    startStopwatch('hold', 5, null, start);

    expect(runningStopwatches()).toEqual({ hold: { startedAtMs: start, baseSeconds: 5, targetSeconds: null } });
  });

  it('resumes a hold from its real start after the app was closed', () => {
    restoreStopwatches({ hold: { startedAtMs: start, baseSeconds: 5, targetSeconds: null } }, start + 40_000);

    expect(stopStopwatch('hold', start + 40_000)).toBe(45);
  });

  it('finishes a countdown whose target passed while the app was closed, waiting to be logged', () => {
    restoreStopwatches({ plank: { startedAtMs: start, baseSeconds: 0, targetSeconds: 30 } }, start + 90_000);

    expect(runningStopwatches().plank.finishedSeconds).toBe(30);
    expect(stopStopwatch('plank', start + 120_000)).toBe(30);
  });

  it('re-arms a countdown that still has time left', () => {
    vi.useFakeTimers();
    vi.setSystemTime(start + 10_000);
    restoreStopwatches({ plank: { startedAtMs: start, baseSeconds: 0, targetSeconds: 30 } });

    expect(runningStopwatches().plank.finishedSeconds).toBeUndefined();
    vi.advanceTimersByTime(20_000);
    expect(runningStopwatches().plank.finishedSeconds).toBe(30);
  });

  it('keeps a stopwatch already counting on this screen over the saved copy', () => {
    startStopwatch('hold', 0, null, start + 50_000);
    restoreStopwatches({ hold: { startedAtMs: start, baseSeconds: 0, targetSeconds: null } }, start + 60_000);

    expect(stopStopwatch('hold', start + 60_000)).toBe(10);
  });

  it('ignores a damaged saved entry', () => {
    restoreStopwatches({ broken: { startedAtMs: Number.NaN, baseSeconds: 0, targetSeconds: null } }, start);

    expect(runningStopwatches()).toEqual({});
  });
});
