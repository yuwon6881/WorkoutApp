import { describe, expect, it } from 'vitest';
import type { MuscleBalanceRow } from '../types';
import { formatSets, peakSets, RANGES, shadeFor } from './muscleBalance';

function row(muscle: string, sets: number): MuscleBalanceRow {
  return { muscle, sets, primarySets: sets, secondarySets: 0, sessions: 1, lastTrainedDate: null };
}

describe('muscle balance shading', () => {
  it('takes the peak from the busiest muscle in the window', () => {
    expect(peakSets([row('Chest', 4), row('Back', 12.5), row('Calves', 0)])).toBe(12.5);
    expect(peakSets([])).toBe(0);
  });

  it('shades every muscle relative to that peak', () => {
    expect(shadeFor(12.5, 12.5)).toBe(1);
    expect(shadeFor(0, 12.5)).toBe(0);
    expect(shadeFor(3.125, 12.5)).toBeCloseTo(0.5, 5);
    expect(shadeFor(1, 4)).toBeCloseTo(0.5, 5);
  });

  it('treats missing, negative, and peakless values as untrained', () => {
    expect(shadeFor(-1, 10)).toBe(0);
    expect(shadeFor(Number.NaN, 10)).toBe(0);
    expect(shadeFor(5, 0)).toBe(0);
    expect(shadeFor(12, 10)).toBe(1);
  });
});

describe('muscle balance display metadata', () => {
  it('formats whole and half-set counts without trailing zeroes', () => {
    expect(formatSets(12)).toBe('12');
    expect(formatSets(12.5)).toBe('12.5');
  });

  it('defines the three selectable time ranges', () => {
    expect(RANGES).toEqual([
      { value: '1w', label: 'Last week' },
      { value: '1m', label: 'Last month' },
      { value: '3m', label: 'Last 3 months' }
    ]);
  });
});
