import { describe, expect, it } from 'vitest';
import { describeLoad, describeSource, formatAvailableLoads, generateLoads, loadSettingToKg, nextAvailableLoad } from './exerciseLoads';
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

describe('shared weight rules', () => {
  it('fills a list evenly, as an odd machine stack needs', () => {
    expect(generateLoads(8.75, 8.75, 4)).toEqual([8.75, 17.5, 26.25, 35]);
    expect(generateLoads(2.5, 2.5, 3)).toEqual([2.5, 5, 7.5]);
    expect(generateLoads(5, 0, 3)).toEqual([]);
    expect(generateLoads(5, 5, 500)).toHaveLength(200);
  });

  it('says what rule is in use and where it comes from', () => {
    expect(describeLoad(2.5, null, 'kg')).toBe('2.5 kg steps');
    expect(describeLoad(0, null, 'kg')).toBe('Fixed load, progress by reps');
    expect(describeLoad(null, [5, 10], 'kg')).toBe('5, 10 kg');
    expect(describeSource('equipment', 'cable')).toBe('Cable default');
    expect(describeSource('exercise', null)).toBe("This exercise's setting");
    expect(describeSource('app', 'cable')).toBe('App default');
  });
});
