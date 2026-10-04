import { MAX_SET_SECONDS } from './setDuration';

/// A set's duration is typed like a microwave clock: digits fill from the right, so 1, 3, 0 reads
/// 1:30. The typed digits are kept apart from the formatted text so the colon and the padding zero
/// are never read back as digits.
const MAX_DIGITS = 4;

const trim = (digits: string): string => digits.replace(/\D/g, '').replace(/^0+/, '').slice(-MAX_DIGITS);

export function formatClockDigits(digits: string): string {
  const clean = trim(digits);
  if (!clean) return '0:00';
  if (clean.length <= 2) return `0:${clean.padStart(2, '0')}`;
  return `${clean.slice(0, -2)}:${clean.slice(-2)}`;
}

/// Seconds the digits stand for; "90" is ninety seconds, which reads back as 1:30.
export function parseClockDigits(digits: string): number | null {
  const clean = trim(digits);
  if (!clean) return null;
  const seconds = Number(clean.slice(-2));
  const minutes = Number(clean.slice(0, -2) || 0);
  return Math.min(MAX_SET_SECONDS, minutes * 60 + seconds);
}

export function secondsToClockDigits(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? String(rest) : `${minutes}${String(rest).padStart(2, '0')}`;
}

/// Adds whatever digits the keyboard sent; anything else it sent is ignored.
export const pushClockDigits = (digits: string, typed: string): string => trim(`${digits}${typed}`);

export const popClockDigit = (digits: string): string => trim(digits).slice(0, -1);

/// Rewrites the digits the way the saved seconds read, so "90" becomes "130" (1:30).
export const normalizeClockDigits = (digits: string): string => secondsToClockDigits(parseClockDigits(digits));
