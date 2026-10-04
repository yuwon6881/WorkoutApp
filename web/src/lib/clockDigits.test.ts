import { describe, expect, it } from 'vitest';
import {
  formatClockDigits, normalizeClockDigits, parseClockDigits, popClockDigit, pushClockDigits, secondsToClockDigits
} from './clockDigits';

describe('clock digits', () => {
  it('fills from the right like a microwave clock', () => {
    let digits = '';
    for (const typed of ['4', '5']) digits = pushClockDigits(digits, typed);
    expect(formatClockDigits(digits)).toBe('0:45');
    digits = pushClockDigits(digits, '5');
    expect(formatClockDigits(digits)).toBe('4:55');
    expect(parseClockDigits(digits)).toBe(295);
  });

  it('never reads the colon or the padding zero of the shown text as typed digits', () => {
    // A keyboard that hands over the whole field value sends "0:45" plus the new digit.
    expect(pushClockDigits('', '0:455')).toBe('455');
    expect(formatClockDigits('0:455')).toBe('4:55');
  });

  it('keeps at most four digits and ignores non-digits', () => {
    expect(pushClockDigits('1234', '5')).toBe('2345');
    expect(pushClockDigits('12', 'a')).toBe('12');
  });

  it('removes the last typed digit', () => {
    expect(popClockDigit('130')).toBe('13');
    expect(popClockDigit('5')).toBe('');
    expect(popClockDigit('')).toBe('');
  });

  it('treats no digits as no time', () => {
    expect(parseClockDigits('')).toBeNull();
    expect(parseClockDigits('000')).toBeNull();
    expect(formatClockDigits('')).toBe('0:00');
  });

  it('normalizes overflowing seconds to the way the saved time reads', () => {
    expect(parseClockDigits('90')).toBe(90);
    expect(normalizeClockDigits('90')).toBe('130');
    expect(formatClockDigits(normalizeClockDigits('90'))).toBe('1:30');
    expect(normalizeClockDigits('')).toBe('');
  });

  it('round-trips saved seconds', () => {
    expect(secondsToClockDigits(45)).toBe('45');
    expect(secondsToClockDigits(90)).toBe('130');
    expect(secondsToClockDigits(null)).toBe('');
    expect(parseClockDigits(secondsToClockDigits(3599))).toBe(3599);
  });

  it('reads seconds past 59 in the largest entry as overflow, like any other', () => {
    expect(parseClockDigits('9999')).toBe(99 * 60 + 99);
  });
});
