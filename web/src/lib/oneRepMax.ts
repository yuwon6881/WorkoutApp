import type { Unit } from '../types';
import { showWeight, toDisplay, toKg } from './training';

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

/// One line for the setting row. A typed value never hides what the logged sets say: when the two
/// differ, the estimate is named beside it so a value typed long ago does not go quietly stale.
export function describeOneRepMax(view: OneRepMaxView, unit: Unit): string {
  const purpose = 'Used for sets a program prints as a percentage of 1RM.';
  const estimate = view.estimatedKg === null ? null : showEstimatedMax(view.estimatedKg, unit);
  if (view.overrideKg !== null) {
    const typed = showWeight(view.overrideKg, unit);
    // Within a small plate either way the two agree; naming the estimate would only be noise.
    const agrees = view.estimatedKg === null || Math.abs(view.estimatedKg - view.overrideKg) < view.overrideKg * 0.025;
    return estimate === null || agrees
      ? `${typed}, entered by you. ${purpose}`
      : `${typed}, entered by you. Your recent heavy sets suggest about ${estimate}.`;
  }
  if (estimate !== null) return `About ${estimate}, estimated from your recent heavy sets. ${purpose}`;
  return 'Not set yet. Enter one so percentage-based sets can show a weight.';
}

/// The estimate as a whole number in the account unit: it is approximate, so decimals would overstate it.
export const showEstimatedMax = (kg: number, unit: Unit): string => `${Math.round(toDisplay(kg, unit) ?? 0)} ${unit}`;

/// A set prints a percentage load such as "75%", "80-85%" or "82.5-87.5% 1RM".
export const isPercentLoad = (loadText: string | null | undefined, notes?: string | null): boolean => {
  if (/percentage of top set/i.test(notes ?? '')) return false;
  const match = /^\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*%\s*(?:1\s*RM)?\s*$/i.exec(loadText ?? '');
  if (!match) return false;
  const low = Number(match[1]);
  const high = match[2] ? Number(match[2]) : low;
  return low >= 10 && high <= 125 && high >= low;
};

/// Keep the printed percentage visible even when a suggested weight is already filled in.
export function percentagePrescription(loadText: string | null | undefined, notes?: string | null): string | null {
  const text = loadText?.trim();
  if (!text || !/\d\s*%/.test(text)) return null;
  if (/percentage of top set/i.test(notes ?? '') && /^\s*\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*%\s*$/i.test(text)) {
    return `${text} of top set`;
  }
  if (isPercentLoad(text, notes) && !/1\s*rm/i.test(text)) return `${text} 1RM`;
  return text;
}
