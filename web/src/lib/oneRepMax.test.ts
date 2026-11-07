import { describe, expect, it } from 'vitest';
import { isPercentLoad, oneRepMaxField, parseOneRepMax } from './oneRepMax';

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

  it('recognises the percentage loads the server turns into weights', () => {
    for (const text of ['75%', '80-85%', '82.5–87.5% 1RM']) expect(isPercentLoad(text)).toBe(true);
    for (const text of ['', null, 'add weight', '140 kg']) expect(isPercentLoad(text)).toBe(false);
    expect(isPercentLoad('100-105%')).toBe(true);
    expect(isPercentLoad('150%')).toBe(false);
    expect(isPercentLoad('85-80%')).toBe(false);
    expect(isPercentLoad('60%', 'Percentage of top set')).toBe(false);
  });
});
