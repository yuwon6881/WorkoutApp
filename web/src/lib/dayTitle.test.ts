import { describe, expect, it } from 'vitest';
import { dayTitle, isGenericDayTitle } from './dayTitle';

describe('dayTitle', () => {
  it('drops a printed slot number that repeats the slot label', () => {
    expect(dayTitle('Day 1 Lower Focused Full Body', 1)).toBe('Lower Focused Full Body');
    expect(dayTitle('DAY 5: Deltoid Focused Full Body', 5)).toBe('Deltoid Focused Full Body');
    expect(dayTitle('Day 2 – Chest', 2)).toBe('Chest');
  });

  it('keeps a number that differs from the slot and names without one', () => {
    expect(dayTitle('Day 3 Pull', 4)).toBe('Day 3 Pull');
    expect(dayTitle('Upper A', 1)).toBe('Upper A');
    expect(dayTitle('Day 10 Legs', 1)).toBe('Day 10 Legs');
  });

  it('reports a bare day number as having no name of its own', () => {
    expect(dayTitle('Day 1', 1)).toBe('');
    expect(isGenericDayTitle(dayTitle('Day 1', 1))).toBe(true);
    expect(isGenericDayTitle(dayTitle('Day 3', 4))).toBe(true);
    expect(isGenericDayTitle(dayTitle(null, 1))).toBe(true);
    expect(isGenericDayTitle(dayTitle('Day 1 Lower', 1))).toBe(false);
  });
});
