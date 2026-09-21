import type { MuscleBalanceRange } from '../types';

export type MuscleBand = 0 | 1 | 2 | 3 | 4;

export const RANGES = [
  { value: '1w', label: 'Last week' },
  { value: '1m', label: 'Last month' },
  { value: '3m', label: 'Last 3 months' }
] as const satisfies ReadonlyArray<{ value: MuscleBalanceRange; label: string }>;

export const BAND_LABELS = ['Not trained', 'Light', 'Maintenance', 'Productive', 'High'] as const;

/// Weekly evidence bands: 0, <5, <10, 10–20, and >20 sets, scaled to the selected window.
export function bandFor(sets: number, weeks: number): MuscleBand {
  if (!Number.isFinite(sets) || sets <= 0 || !Number.isFinite(weeks) || weeks <= 0) return 0;

  if (sets < 5 * weeks) return 1;
  if (sets < 10 * weeks) return 2;
  if (sets <= 20 * weeks) return 3;
  return 4;
}

/// Muscle credits are whole or half sets, so one decimal place is enough for display.
export function formatSets(sets: number): string {
  if (!Number.isFinite(sets)) return '0';

  const rounded = Math.round(Math.max(0, sets) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
