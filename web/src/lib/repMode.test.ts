import { describe, expect, it } from 'vitest';
import { usesRepRange, withRepMode } from './repMode';

describe('rep mode', () => {
  it('treats an exercise as a range when any set has distinct bounds', () => {
    expect(usesRepRange([{ repMin: 10, repMax: 10 }, { repMin: 8, repMax: 12 }])).toBe(true);
    expect(usesRepRange([{ repMin: 10, repMax: 10 }, { repMin: 6, repMax: 6 }])).toBe(false);
    expect(usesRepRange([])).toBe(false);
  });

  it('collapses to the lower bound for exact reps', () => {
    expect(withRepMode({ repMin: 8, repMax: 12 }, false)).toEqual({ repMin: 8, repMax: 8 });
  });

  it('keeps an existing range and widens an exact target by two', () => {
    expect(withRepMode({ repMin: 8, repMax: 12 }, true)).toEqual({ repMin: 8, repMax: 12 });
    expect(withRepMode({ repMin: 10, repMax: 10 }, true)).toEqual({ repMin: 10, repMax: 12 });
  });
});
