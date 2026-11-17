import { describe, expect, it } from 'vitest';
import { formatPairingCode, isCompletePairingCode } from './watchPairingCode';

describe('formatPairingCode', () => {
  it('keeps every character of a code pasted with spaces and a dash', () => {
    expect(formatPairingCode('  abcd - efgh ')).toBe('ABCD-EFGH');
    expect(formatPairingCode('AB CD-EF GH')).toBe('ABCD-EFGH');
    expect(isCompletePairingCode(formatPairingCode('  abcd - efgh '))).toBe(true);
  });

  it('formats as it is typed and caps the code at eight characters', () => {
    expect(formatPairingCode('abc')).toBe('ABC');
    expect(formatPairingCode('abcd')).toBe('ABCD');
    expect(formatPairingCode('abcde')).toBe('ABCD-E');
    expect(formatPairingCode('ABCD-')).toBe('ABCD');
    expect(formatPairingCode('abcdefghij')).toBe('ABCD-EFGH');
    expect(isCompletePairingCode('ABCD-EFG')).toBe(false);
  });
});
