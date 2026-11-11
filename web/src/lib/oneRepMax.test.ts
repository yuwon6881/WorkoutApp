import { describe, expect, it } from 'vitest';
import { describeOneRepMax, isPercentLoad, oneRepMaxField, parseOneRepMax, percentagePrescription } from './oneRepMax';

describe('one-rep max entry', () => {
  it('reads kilograms and converts pounds to kilograms', () => {
    expect(parseOneRepMax('140', 'kg')).toEqual({ kg: 140, error: null });
    expect(parseOneRepMax('315', 'lb').kg).toBeCloseTo(142.882, 2);
  });

  it('treats empty text as clearing and rejects unusable values', () => {
    expect(parseOneRepMax('  ', 'kg')).toEqual({ kg: null, error: null });
    for (const bad of ['abc', '0', '-5', '1500']) expect(parseOneRepMax(bad, 'kg').error).toMatch(/Enter a one-rep max/);
  });

  it('shows a stored value in the account unit and nothing when unknown', () => {
    expect(oneRepMaxField(142.882, 'lb')).toBe('315');
    expect(oneRepMaxField(null, 'kg')).toBe('');
  });

  it('names the estimate beside a typed value that differs from it', () => {
    expect(describeOneRepMax({ overrideKg: 100, estimatedKg: 119.6, effectiveKg: 100 }, 'kg'))
      .toBe('100 kg, entered by you. Your recent heavy sets suggest about 120 kg.');
    expect(describeOneRepMax({ overrideKg: 120, estimatedKg: 119.6, effectiveKg: 120 }, 'kg'))
      .toBe('120 kg, entered by you. Used for sets a program prints as a percentage of 1RM.');
  });

  it('says what an estimate is for and when there is nothing to go on', () => {
    expect(describeOneRepMax({ overrideKg: null, estimatedKg: 102.37, effectiveKg: 102.37 }, 'kg'))
      .toBe('About 102 kg, estimated from your recent heavy sets. Used for sets a program prints as a percentage of 1RM.');
    expect(describeOneRepMax({ overrideKg: null, estimatedKg: null, effectiveKg: null }, 'kg')).toMatch(/^Not set yet/);
  });

  it('recognises the percentage loads the server turns into weights', () => {
    for (const text of ['75%', '80-85%', '82.5–87.5% 1RM']) expect(isPercentLoad(text)).toBe(true);
    for (const text of ['', null, 'add weight', '140 kg']) expect(isPercentLoad(text)).toBe(false);
    expect(isPercentLoad('100-105%')).toBe(true);
    expect(isPercentLoad('150%')).toBe(false);
    expect(isPercentLoad('85-80%')).toBe(false);
    expect(isPercentLoad('60%', 'Percentage of top set')).toBe(false);
  });

  it('labels the printed percentage with its basis without inventing one', () => {
    expect(percentagePrescription('70%')).toBe('70% 1RM');
    expect(percentagePrescription('82.5–87.5% 1RM')).toBe('82.5–87.5% 1RM');
    expect(percentagePrescription('60%', 'Percentage of top set')).toBe('60% of top set');
    expect(percentagePrescription('~60% of AMRAP set load')).toBe('~60% of AMRAP set load');
    expect(percentagePrescription('add weight')).toBeNull();
  });
});
