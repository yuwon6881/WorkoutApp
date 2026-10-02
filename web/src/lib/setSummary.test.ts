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
      { count: 1, warmup: true, target: '5' },
      { count: 2, warmup: false, target: '8–10 · 2 RIR' },
      { count: 1, warmup: false, target: '8–10 · 0 RIR' }
    ]);
  });

  it('drops reps in reserve when RIR tracking is off', () => {
    expect(summarizeSets([set(), set({ rir: '0' })], false)).toEqual([{ count: 2, warmup: false, target: '8–10' }]);
  });
});
