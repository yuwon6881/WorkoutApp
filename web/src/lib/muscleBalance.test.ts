import { describe, expect, it } from 'vitest';
import { BAND_LABELS, bandFor, formatSets, RANGES } from './muscleBalance';

describe('muscle balance bands', () => {
  it('uses fixed weekly thresholds and includes both ends of the productive band', () => {
    expect(bandFor(0, 1)).toBe(0);
    expect(bandFor(0.5, 1)).toBe(1);
    expect(bandFor(4.5, 1)).toBe(1);
    expect(bandFor(5, 1)).toBe(2);
    expect(bandFor(9.5, 1)).toBe(2);
    expect(bandFor(10, 1)).toBe(3);
    expect(bandFor(20, 1)).toBe(3);
    expect(bandFor(20.5, 1)).toBe(4);
  });

  it('scales thresholds to monthly and three-month windows', () => {
    const monthWeeks = 30 / 7;
    const quarterWeeks = 91 / 7;

    expect(bandFor(5 * monthWeeks - 0.1, monthWeeks)).toBe(1);
    expect(bandFor(5 * monthWeeks, monthWeeks)).toBe(2);
    expect(bandFor(10 * quarterWeeks, quarterWeeks)).toBe(3);
    expect(bandFor(20 * quarterWeeks, quarterWeeks)).toBe(3);
    expect(bandFor(20 * quarterWeeks + 0.1, quarterWeeks)).toBe(4);
  });

  it('returns the untrained band for invalid or empty values', () => {
    expect(bandFor(-1, 1)).toBe(0);
    expect(bandFor(Number.NaN, 1)).toBe(0);
    expect(bandFor(10, 0)).toBe(0);
  });
});

describe('muscle balance display metadata', () => {
  it('formats whole and half-set counts without trailing zeroes', () => {
    expect(formatSets(12)).toBe('12');
    expect(formatSets(12.5)).toBe('12.5');
  });

  it('defines the three selectable time ranges and five band labels', () => {
    expect(RANGES).toEqual([
      { value: '1w', label: 'Last week' },
      { value: '1m', label: 'Last month' },
      { value: '3m', label: 'Last 3 months' }
    ]);
    expect(BAND_LABELS).toEqual(['Not trained', 'Light', 'Maintenance', 'Productive', 'High']);
  });
});
