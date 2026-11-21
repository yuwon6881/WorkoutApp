import { describe, expect, it } from 'vitest';
import type { DraftSet } from '../types';
import { summarizeSets } from './setSummary';

const set = (overrides: Partial<DraftSet> = {}): DraftSet => ({
  repMin: 8, repMax: 10, targetRpe: null, restSeconds: 90, tempo: null, loadText: null, notes: null,
  repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted', repsText: null, restText: null,
  rir: '2', warmup: false, ...overrides
});

describe('summarizeSets', () => {
  it('groups consecutive identical sets and keeps warm-ups apart', () => {
    const lines = summarizeSets([set({ warmup: true, rir: null, repMin: 5, repMax: 5 }), set(), set(), set({ rir: '0' })], true);
    expect(lines).toEqual([
      { count: 1, warmup: true, target: '5', load: null },
      { count: 2, warmup: false, target: '8–10 · 2 RIR', load: null },
      { count: 1, warmup: false, target: '8–10 · 0 RIR', load: null }
    ]);
  });

  it('drops reps in reserve when RIR tracking is off', () => {
    expect(summarizeSets([set(), set({ rir: '0' })], false)).toEqual([{ count: 2, warmup: false, target: '8–10', load: null }]);
  });

  it('displays server loads when available, and falls back to prescribed loadText when absent', () => {
    const sets = [
      set({ warmup: true, loadText: 'bar' }),
      set({ loadText: '80%' }),
      set({ loadText: '80%' }),
      set({ loadText: '100 kg' })
    ];
    // With server loads for the 80% sets
    const withServerLoads = summarizeSets(sets, true, [null, '140 kg', '140 kg', null]);
    expect(withServerLoads).toEqual([
      { count: 1, warmup: true, target: '8–10', load: null },
      { count: 2, warmup: false, target: '8–10 · 2 RIR', load: '140 kg' },
      { count: 1, warmup: false, target: '8–10 · 2 RIR', load: '100 kg' }
    ]);

    // Without server loads (fallback to loadText)
    const fallbackLoads = summarizeSets(sets, true, []);
    expect(fallbackLoads).toEqual([
      { count: 1, warmup: true, target: '8–10', load: null },
      { count: 2, warmup: false, target: '8–10 · 2 RIR', load: '80%' },
      { count: 1, warmup: false, target: '8–10 · 2 RIR', load: '100 kg' }
    ]);
  });
});
