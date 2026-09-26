import { describe, expect, it } from 'vitest';
import { usesRepRange, withRepMode } from './repMode';
import { showReps } from './training';
import { validatePrescription } from './validation';

const set = (repMin: number | null, repMax: number | null) => ({
  repMin, repMax, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null,
  repsText: null, restText: null, rir: null, warmup: false
});

/// A program that prints no rep count leaves the target empty; nothing stands in for it.
describe('a set with no rep target', () => {
  it('is shown as a dash, never as a count', () => {
    expect(showReps({ repMin: null, repMax: null })).toBe('—');
    expect(showReps({ repMin: 8, repMax: 12 })).toBe('8–12');
  });

  it('is valid with both bounds empty but not with one', () => {
    expect(validatePrescription(set(null, null))).toBeUndefined();
    expect(validatePrescription(set(8, null))).toBe('Give both rep bounds or leave both empty.');
    expect(validatePrescription(set(null, 12))).toBe('Give both rep bounds or leave both empty.');
    expect(validatePrescription(set(12, 8))).toBe('The lowest rep target cannot exceed the highest.');
  });

  it('stays empty when its exercise changes rep mode', () => {
    expect(withRepMode({ repMin: null, repMax: null }, true)).toEqual({ repMin: null, repMax: null });
    expect(withRepMode({ repMin: null, repMax: null }, false)).toEqual({ repMin: null, repMax: null });
    expect(usesRepRange([{ repMin: null, repMax: null }])).toBe(false);
  });
});
