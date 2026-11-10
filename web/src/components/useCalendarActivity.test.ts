import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutActivityItem } from '../types';
import { api } from '../lib/api';
import { localDate, weekDays } from '../lib/training';
import { viewReadCache } from '../lib/viewReadCache';

let effectRunner: (() => void) | null = null;
const stateSlots: { value: unknown; setter: (next: unknown) => void }[] = [];
const refSlots: { current: unknown }[] = [];
let stateCursor = 0;
let refCursor = 0;

vi.mock('react', () => ({
  useRef: <T>(initial: T) => {
    const idx = refCursor++;
    if (!refSlots[idx]) refSlots[idx] = { current: initial };
    return refSlots[idx] as { current: T };
  },
  useMemo: <T>(factory: () => T) => factory(),
  useEffect: (effect: () => void) => { effectRunner = effect; },
  useState: <T>(initial: T) => {
    const idx = stateCursor++;
    if (!stateSlots[idx]) {
      const slot: { value: unknown; setter: (next: unknown) => void } = {
        value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        setter: (next: unknown) => {
          slot.value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(slot.value) : next;
        }
      };
      stateSlots[idx] = slot;
    }
    return [stateSlots[idx].value as T, stateSlots[idx].setter as (next: T) => void];
  }
}));

import { useCalendarActivity } from './useCalendarActivity';

function renderHook(enabled: boolean, refreshKey = 'h:1') {
  stateCursor = 0;
  refCursor = 0;
  effectRunner = null;
  const days = weekDays(0);
  return useCalendarActivity({
    offset: 0,
    accountId: 'acc-1',
    activeWorkoutId: null,
    refreshKey,
    weekFrom: localDate(days[0]),
    weekTo: localDate(days[6]),
    enabled
  });
}

afterEach(() => {
  stateSlots.length = 0;
  refSlots.length = 0;
  stateCursor = 0;
  refCursor = 0;
  effectRunner = null;
  viewReadCache.reset();
  vi.restoreAllMocks();
});

describe('useCalendarActivity', () => {
  it('stays loading without fetching or reading cache while launch confirmation is pending', async () => {
    const windowFrom = localDate(weekDays(-1)[0]);
    const windowTo = localDate(weekDays(1)[6]);
    const item: WorkoutActivityItem = { id: 's-1', name: 'Push', date: localDate(weekDays(0)[0]), status: 'completed', trainingMinutes: 45 };
    viewReadCache.set(`acc-1:activity:${windowFrom}:${windowTo}:`, 'h:1', [item]);
    const activitySpy = vi.spyOn(api, 'activity').mockResolvedValue([item]);

    const unconfirmed = renderHook(false);
    effectRunner?.();
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(unconfirmed.loading).toBe(true);
    expect(unconfirmed.items).toEqual([]);
    expect(activitySpy).not.toHaveBeenCalled();

    renderHook(true, 'h:2');
    effectRunner?.();
    await new Promise(resolve => setTimeout(resolve, 20));
    const confirmed = renderHook(true, 'h:2');

    expect(activitySpy).toHaveBeenCalledTimes(1);
    expect(confirmed.loading).toBe(false);
    expect(confirmed.items).toEqual([item]);
  });
});
