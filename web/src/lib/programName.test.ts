import { describe, expect, it } from 'vitest';
import { capProgramName } from './programName';

describe('capProgramName', () => {
  it('returns empty string for null, undefined, or empty names', () => {
    expect(capProgramName(null)).toBe('');
    expect(capProgramName(undefined)).toBe('');
    expect(capProgramName('')).toBe('');
    expect(capProgramName('   ')).toBe('');
  });

  it('keeps program names shorter than or equal to max length (default 36)', () => {
    expect(capProgramName('Push Pull Legs')).toBe('Push Pull Legs');
    const exact36 = 'A'.repeat(36);
    expect(capProgramName(exact36)).toBe(exact36);
  });

  it('truncates program names longer than 36 characters with ellipsis', () => {
    const name37 = 'A'.repeat(37);
    expect(capProgramName(name37)).toBe('A'.repeat(36) + '…');

    const longName = 'Hypertrophy Specific Training 4-Day Upper Lower Split';
    expect(longName.length).toBeGreaterThan(36);
    expect(capProgramName(longName)).toBe('Hypertrophy Specific Training 4-Day …');
  });

  it('supports custom max length', () => {
    expect(capProgramName('Upper Lower', 5)).toBe('Upper…');
    expect(capProgramName('Upper Lower', 11)).toBe('Upper Lower');
    expect(capProgramName('Upper Lower', 20)).toBe('Upper Lower');
  });

  it('trims whitespace before capping', () => {
    expect(capProgramName('   Full Body Program   ')).toBe('Full Body Program');
  });
});
