import { describe, expect, it } from 'vitest';
import { formatTypedNumber, parseTypedNumber } from './numberInput';

describe('typed numbers', () => {
  it('accepts a comma or a point as the decimal mark', () => {
    expect(parseTypedNumber('62,5', { decimals: 2 })).toEqual({ value: 62.5, complete: true });
    expect(parseTypedNumber('62.5', { decimals: 2 })).toEqual({ value: 62.5, complete: true });
  });

  it('treats a trailing mark as unfinished typing, not an error', () => {
    expect(parseTypedNumber('62.', { decimals: 2 })).toEqual({ value: 62, complete: false });
    expect(parseTypedNumber('', { decimals: 2 })).toEqual({ value: null, complete: true });
  });

  it('rejects letters, negatives, and decimals where none are allowed', () => {
    expect(parseTypedNumber('6a', { decimals: 2 })).toBeNull();
    expect(parseTypedNumber('-5', { decimals: 2 })).toBeNull();
    expect(parseTypedNumber('8.5', { decimals: 0 })).toBeNull();
    expect(parseTypedNumber('1.234', { decimals: 2 })).toBeNull();
  });

  it('formats without trailing zeros', () => {
    expect(formatTypedNumber(62.5, 2)).toBe('62.5');
    expect(formatTypedNumber(60, 2)).toBe('60');
    expect(formatTypedNumber(null, 2)).toBe('');
  });
});
