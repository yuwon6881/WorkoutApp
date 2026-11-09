import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { viewReadCache } from '../lib/viewReadCache';

let currentScope: string | null = '["acc-1",{"history":1}]';
let effectRunner: (() => void) | null = null;
const holders: { value: unknown; setter: (next: unknown) => void }[] = [];
let stateIndex = 0;

vi.mock('react', () => ({
  createContext: <T>(initial: T) => ({ _initial: initial }),
  useContext: () => currentScope,
  useRef: <T>(current: T) => ({ current }),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
  useEffect: (effect: () => void) => { effectRunner = effect; },
  useState: <T>(initial: T) => {
    const index = stateIndex++;
    if (!holders[index]) {
      const holder: { value: unknown; setter: (next: unknown) => void } = {
        value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        setter: (next: unknown) => {
          holder.value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(holder.value) : next;
        }
      };
      holders[index] = holder;
    }
    return [holders[index].value as T, holders[index].setter as (next: T) => void];
  }
}));

import { useLastPerformedRead } from './useLastPerformed';

function renderHook(enabled: boolean) {
  stateIndex = 0;
  effectRunner = null;
  return useLastPerformedRead(enabled);
}

afterEach(() => {
  holders.length = 0;
  stateIndex = 0;
  effectRunner = null;
  currentScope = '["acc-1",{"history":1}]';
  viewReadCache.reset();
  vi.restoreAllMocks();
});

describe('useLastPerformedRead', () => {
  it('reuses a fresh shared last-performed snapshot without issuing another request', () => {
    const spy = vi.spyOn(api, 'lastPerformed').mockResolvedValue([]);
    viewReadCache.set(`${currentScope}:last-performed`, 1, [{
      exerciseId: 'bench', weightKg: 100, reps: 8, durationSeconds: null, finishedAt: '2026-10-27T12:00:00Z'
    }]);

    const read = renderHook(true);
    effectRunner?.();

    expect(read.settled).toBe(true);
    expect(read.map.get('bench')?.weightKg).toBe(100);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fetches once when uncached and settles with an empty map if the optional read fails', async () => {
    const spy = vi.spyOn(api, 'lastPerformed').mockRejectedValue(new Error('network down'));

    const initial = renderHook(true);
    expect(initial.settled).toBe(false);
    expect(initial.map.size).toBe(0);

    effectRunner?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    const afterError = renderHook(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(afterError.settled).toBe(true);
    expect(afterError.map.size).toBe(0);
  });

  it('ignores cached snapshots from another account or history generation', () => {
    viewReadCache.set(`${currentScope}:last-performed`, 1, [{
      exerciseId: 'bench', weightKg: 100, reps: 8, durationSeconds: null, finishedAt: '2026-10-27T12:00:00Z'
    }]);
    currentScope = '["acc-1",{"history":2}]';

    const read = renderHook(true);
    expect(read.settled).toBe(false);
    expect(read.map.size).toBe(0);
  });
});
