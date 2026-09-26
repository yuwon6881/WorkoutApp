import { describe, expect, it } from 'vitest';
import { formatAvailableLoads, loadSettingToKg, nextAvailableLoad } from './exerciseLoads';
import { validateExerciseLoads } from './validation';

describe('personal exercise weights', () => {
  it('converts pound equipment without rounding the stored availability', () => {
    const weights = [10, 15, 25].map(value => loadSettingToKg(value, 'lb'));
    expect(formatAvailableLoads(weights, 'lb')).toBe('10, 15, 25');
    expect(formatAvailableLoads(weights, 'kg')).toBe('4.54, 6.8, 11.34');
    expect(loadSettingToKg(2.5, 'kg')).toBe(2.5);
  });
  it('moves across gaps, respects boundaries and tolerates logged conversion rounding', () => {
    expect(nextAvailableLoad(null, [5, 10, 17.5], 1)).toBe(5);
    expect(nextAvailableLoad(11, [5, 10, 17.5], 1)).toBe(17.5);
    expect(nextAvailableLoad(17.5, [5, 10, 17.5], 1)).toBe(17.5);
    expect(nextAvailableLoad(11, [5, 10, 17.5], -1)).toBe(10);
    const weights = [20, 40, 60].map(value => loadSettingToKg(value, 'lb'));
    expect(nextAvailableLoad(Number(weights[1].toFixed(3)), weights, 1)).toBe(weights[2]);
  });
  it('rejects blank, non-finite, negative and oversized inputs', () => {
    expect(validateExerciseLoads('', [0], false)).toBeTruthy();
    expect(validateExerciseLoads('bad', [NaN], false)).toBeTruthy();
    expect(validateExerciseLoads('-1', [-1], false)).toBeTruthy();
    expect(validateExerciseLoads('51', [51], false)).toBeTruthy();
    expect(validateExerciseLoads('5,5', [5, 5], true)).toBeTruthy();
    expect(validateExerciseLoads('5,10', [5, 10], true)).toBeUndefined();
    expect(validateExerciseLoads('0', [0], false)).toBeUndefined();
  });
});
