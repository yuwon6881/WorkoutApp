import type { Unit } from '../types';
import { toDisplay, toKg } from './training';

/// What the server knows about a lift's one-rep max: the value the lifter typed, the estimate from
/// their recent heavy sets, and the one a percentage-based program uses (typed first).
export type OneRepMaxView = { overrideKg: number | null; estimatedKg: number | null; effectiveKg: number | null };

/// Parses what was typed in the account unit; null means empty. Returns an error for anything that
/// is not a usable load so the form can say why instead of saving a guess.
export function parseOneRepMax(text: string, unit: Unit): { kg: number | null; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { kg: null, error: null };
  const value = Number(trimmed);
  const kg = Number.isFinite(value) ? toKg(value, unit) : null;
  if (kg === null || kg <= 0 || kg > 1000) return { kg: null, error: `Enter a one-rep max above 0 and at most ${unit === 'lb' ? '2204' : '1000'} ${unit}.` };
  return { kg, error: null };
}

export const oneRepMaxField = (kg: number | null, unit: Unit): string => {
  const value = toDisplay(kg, unit);
  return value === null ? '' : String(Number(value.toFixed(1)));
};

/// A set prints a percentage load such as "75%", "80-85%" or "82.5-87.5% 1RM".
export const isPercentLoad = (loadText: string | null | undefined): boolean =>
  !!loadText && /^\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*%\s*(?:1\s*RM)?\s*$/i.test(loadText);
