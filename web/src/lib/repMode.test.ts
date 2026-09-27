import { describe, expect, it } from 'vitest';
import { toggleRepMode, usesRepRange, withRepMode } from './repMode';

describe('rep mode', () => {
  it('shows a printed single rep count as exact and an exercise as a range when any set has distinct bounds', () => {
    expect(usesRepRange([{ repMin: 8, repMax: 8 }])).toBe(false);
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

  it('restores each original range after an exact-mode round trip', () => {
    const source = [{ repMin: 8, repMax: 12 }, { repMin: 6, repMax: 9 }];
    const rememberedWidths = new Map<number, number>();

    const exact = toggleRepMode(source, false, rememberedWidths);
    expect(exact).toEqual([{ repMin: 8, repMax: 8 }, { repMin: 6, repMax: 6 }]);
    const exactAfterRepeatClick = toggleRepMode(exact, false, rememberedWidths);
    expect(toggleRepMode(exactAfterRepeatClick, true, rememberedWidths)).toEqual(source);
  });

  it('keeps exact sets exact when a mixed prescription returns to range mode', () => {
    const source = [{ repMin: 8, repMax: 8 }, { repMin: 8, repMax: 12 }];
    const rememberedWidths = new Map<number, number>();

    const exact = toggleRepMode(source, false, rememberedWidths);
    expect(toggleRepMode(exact, true, rememberedWidths)).toEqual(source);
  });

  it('does not remember a range width when exact mode was already active', () => {
    const rememberedWidths = new Map<number, number>();
    const exact = [{ repMin: 8, repMax: 8 }];

    expect(toggleRepMode(toggleRepMode(exact, false, rememberedWidths), true, rememberedWidths))
      .toEqual([{ repMin: 8, repMax: 10 }]);
  });

  it('keeps the remembered range width if the exact target is edited', () => {
    const rememberedWidths = new Map<number, number>();
    const exact = toggleRepMode([{ repMin: 8, repMax: 12 }], false, rememberedWidths);
    expect(toggleRepMode([{ ...exact[0], repMin: 10, repMax: 10 }], true, rememberedWidths))
      .toEqual([{ repMin: 10, repMax: 14 }]);
  });
});
