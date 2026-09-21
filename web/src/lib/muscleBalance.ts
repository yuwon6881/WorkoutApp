import type { MuscleBalanceRange, MuscleBalanceRow } from '../types';

export const RANGES = [
  { value: '1w', label: 'Last week' },
  { value: '1m', label: 'Last month' },
  { value: '3m', label: 'Last 3 months' }
] as const satisfies ReadonlyArray<{ value: MuscleBalanceRange; label: string }>;

/// The busiest muscle in the window. Shading is relative to it, so the map answers "where did my
/// sets go" for this window instead of grading the work against a fixed target.
export function peakSets(rows: readonly MuscleBalanceRow[]): number {
  return rows.reduce((peak, row) => (Number.isFinite(row.sets) && row.sets > peak ? row.sets : peak), 0);
}

/// How deep a muscle is shaded, from 0 (untrained) to 1 (the peak). The square root keeps the
/// lighter end of the scale distinguishable when one muscle dominates the window.
export function shadeFor(sets: number, peak: number): number {
  if (!Number.isFinite(sets) || sets <= 0 || !Number.isFinite(peak) || peak <= 0) return 0;
  return Math.min(1, Math.sqrt(sets / peak));
}

/// Muscle credits are whole or half sets, so one decimal place is enough for display.
export function formatSets(sets: number): string {
  if (!Number.isFinite(sets)) return '0';

  const rounded = Math.round(Math.max(0, sets) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
