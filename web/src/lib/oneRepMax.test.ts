import { describe, expect, it } from 'vitest';
import { isPercentLoad, percentagePrescription } from './oneRepMax';

describe('percentage prescriptions', () => {
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
