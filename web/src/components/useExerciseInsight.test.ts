import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseInsight } from '../types';
import { api } from '../lib/api';
import { viewReadCache } from '../lib/viewReadCache';

let currentScope: string | null = '["acc-1",{"history":1}]';
let effectEntries: { effect: () => void | (() => void); deps?: unknown[] }[] = [];
const cleanups = new Map<number, void | (() => void)>();
const prevDeps = new Map<number, unknown[] | undefined>();
const stateSlots: { value: unknown; setter: (next: unknown) => void }[] = [];
const refSlots: { current: unknown }[] = [];
const memoSlots: { value: unknown; deps?: unknown[] }[] = [];
let stateCursor = 0;
let refCursor = 0;
let memoCursor = 0;

function sameDeps(a?: unknown[], b?: unknown[]) {
  return Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
}

vi.mock('react', () => ({
  createContext: <T>(initial: T) => ({ _initial: initial }),
  useContext: () => currentScope,
  useRef: <T>(initial: T) => {
    const index = refCursor++;
    if (!refSlots[index]) refSlots[index] = { current: initial };
    return refSlots[index] as { current: T };
  },
  useCallback: <T>(callback: T, deps?: unknown[]) => {
    const index = memoCursor++;
    const slot = memoSlots[index];
    if (slot && sameDeps(slot.deps, deps)) return slot.value as T;
    memoSlots[index] = { value: callback, deps };
    return callback;
  },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    effectEntries.push({ effect, deps });
  },
  useState: <T>(initial: T) => {
    const index = stateCursor++;
    if (!stateSlots[index]) {
      const slot: { value: unknown; setter: (next: unknown) => void } = {
        value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        setter: (next: unknown) => {
          slot.value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(slot.value) : next;
        }
      };
      stateSlots[index] = slot;
    }
    return [stateSlots[index].value as T, stateSlots[index].setter as (next: T) => void];
  }
}));

import { keepLoadedHistory, useExerciseInsight } from './useExerciseInsight';

function renderHook(exerciseId = 'bench', onChanged?: () => Promise<void> | void) {
  stateCursor = 0;
  refCursor = 0;
  memoCursor = 0;
  effectEntries = [];
  const result = useExerciseInsight(exerciseId, onChanged);
  effectEntries.forEach((entry, index) => {
    if (!prevDeps.has(index) || !sameDeps(prevDeps.get(index), entry.deps)) {
      const previous = cleanups.get(index);
      if (typeof previous === 'function') previous();
      cleanups.set(index, entry.effect());
      prevDeps.set(index, entry.deps);
    }
  });
  return result;
}

function pagePayload(page: number, totalHistoryRows: number, prefix: string): ExerciseInsight {
  return {
    id: 'bench',
    name: 'Bench',
    muscle: 'Chest',
    equipment: 'Barbell',
    loadModel: 'external',
    loadStepKg: 2.5,
    isCustom: false,
    archived: false,
    sessions: 4,
    setCount: 12,
    clearableSetCount: 12,
    totalHistoryRows,
    page,
    size: 1,
    estimated1RmKg: 120,
    estimated1RmDate: '2026-10-27',
    heaviestKg: 100,
    heaviestReps: 8,
    heaviestDate: '2026-10-27',
    largestSetVolumeKg: 800,
    largestSetVolumeDate: '2026-10-27',
    largestSessionVolumeKg: 2400,
    largestSessionVolumeDate: '2026-10-27',
    repPr: 10,
    repPrDate: '2026-10-27',
    lastPerformedDate: '2026-10-27',
    partialVolume: false,
    points: [],
    history: [{
      sessionId: `${prefix}-${page}`,
      sessionName: `${prefix} ${page}`,
      programName: null,
      date: '2026-10-27',
      setCount: 3,
      volumeKg: 2400,
      partial: false,
      finishedAt: '2026-10-27T12:00:00Z'
    }]
  };
}

afterEach(() => {
  for (const cleanup of cleanups.values()) if (typeof cleanup === 'function') cleanup();
  cleanups.clear();
  prevDeps.clear();
  stateSlots.length = 0;
  refSlots.length = 0;
  memoSlots.length = 0;
  effectEntries = [];
  stateCursor = 0;
  refCursor = 0;
  memoCursor = 0;
  currentScope = '["acc-1",{"history":1}]';
  viewReadCache.reset();
  vi.restoreAllMocks();
});

describe('useExerciseInsight cache pagination and invalidation', () => {
  it('persists loaded history pages into viewReadCache across range switches', async () => {
    const spy = vi.spyOn(api, 'exerciseInsight').mockImplementation(async (_id, range, page) => {
      if (range === '3m' && page === 0) return pagePayload(0, 2, '3m');
      if (range === '3m' && page === 1) return pagePayload(1, 2, '3m');
      if (range === '1m' && page === 0) return pagePayload(0, 1, '1m');
      throw new Error(`Unexpected call: ${range} page ${page}`);
    });

    let hook = renderHook('bench');
    await new Promise(resolve => setTimeout(resolve, 0));
    hook = renderHook('bench');
    expect(hook.insight?.history.map(item => item.sessionId)).toEqual(['3m-0']);

    await hook.moreHistory();
    hook = renderHook('bench');
    expect(hook.insight?.history.map(item => item.sessionId)).toEqual(['3m-0', '3m-1']);

    // Switch away to 1m, then back to 3m: page 0 and page 1 must remain cached with 0 refetches.
    hook.setRange('1m');
    hook = renderHook('bench');
    await new Promise(resolve => setTimeout(resolve, 0));
    hook = renderHook('bench');
    expect(hook.insight?.history.map(item => item.sessionId)).toEqual(['1m-0']);

    hook.setRange('3m');
    hook = renderHook('bench');
    await new Promise(resolve => setTimeout(resolve, 0));
    hook = renderHook('bench');
    expect(hook.insight?.history.map(item => item.sessionId)).toEqual(['3m-0', '3m-1']);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('aborts in-flight moreHistory responses across range changes and historyCleared', async () => {
    let resolvePage!: (value: ExerciseInsight) => void;
    let captureSignal!: AbortSignal | undefined;
    vi.spyOn(api, 'exerciseInsight').mockImplementation((_id, range, page, _size, signal) => {
      if (page === 0) return Promise.resolve(pagePayload(0, 2, `${range}`));
      captureSignal = signal;
      return new Promise<ExerciseInsight>(resolve => { resolvePage = resolve; });
    });

    let hook = renderHook('bench');
    await new Promise(resolve => setTimeout(resolve, 0));
    hook = renderHook('bench');

    const pendingMore = hook.moreHistory();
    expect(captureSignal?.aborted).toBe(false);

    hook.setRange('1m');
    hook = renderHook('bench');
    expect(captureSignal?.aborted).toBe(true);
    expect(hook.historyBusy).toBe(false);

    resolvePage(pagePayload(1, 2, 'stale-3m'));
    await pendingMore;

    await new Promise(resolve => setTimeout(resolve, 0));
    hook = renderHook('bench');
    expect(hook.insight?.history.map(item => item.sessionId)).toEqual(['1m-0']);

    const cachedAfterClear = vi.spyOn(api, 'exerciseInsight').mockResolvedValue(pagePayload(0, 0, 'cleared'));
    await hook.historyCleared();
    hook = renderHook('bench');
    expect(cachedAfterClear).toHaveBeenCalled();
    expect(hook.insight?.history).toHaveLength(1);
  });
});

describe('keepLoadedHistory', () => {
  const row = (sessionId: string) => ({ ...pagePayload(0, 3, 'x').history[0], sessionId });
  const insight = (ids: string[], page: number, totalHistoryRows = 3): ExerciseInsight =>
    ({ ...pagePayload(0, totalHistoryRows, 'x'), totalHistoryRows, page, history: ids.map(row) });

  it('keeps the pages already loaded when another range answers with the first page of the same history', () => {
    const kept = keepLoadedHistory(insight(['a', 'b', 'c'], 1), insight(['a', 'b'], 0));
    expect(kept.history.map(item => item.sessionId)).toEqual(['a', 'b', 'c']);
    expect(kept.page).toBe(1);
  });

  it('takes the new answer when the history itself changed', () => {
    const fewer = insight(['a'], 0, 1);
    expect(keepLoadedHistory(insight(['a', 'b', 'c'], 1), fewer)).toBe(fewer);
    const newer = insight(['n', 'a'], 0);
    expect(keepLoadedHistory(insight(['a', 'b', 'c'], 1), newer)).toBe(newer);
    expect(keepLoadedHistory(null, newer)).toBe(newer);
  });
});
