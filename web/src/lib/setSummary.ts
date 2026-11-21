import type { DraftSet, SetPrescription } from '../types';
import { showTarget } from './training';

export type SetSummaryLine = { count: number; warmup: boolean; target: string; load: string | null };

/// Collapses consecutive sets that ask for the same thing into one "3 × 8–10 · 2 RIR" line (sets with a different known load stay apart), so a
/// read-only day reads like the printed program rather than a row per set.
export function summarizeSets(sets: (SetPrescription | DraftSet)[], trackRir: boolean, loads: readonly (string | null | undefined)[] = []): SetSummaryLine[] {
  const lines: SetSummaryLine[] = [];
  for (const [index, set] of sets.entries()) {
    const target = showTarget(set, trackRir && !set.warmup);
    const load = loads[index] ?? null;
    const previous = lines.at(-1);
    if (previous && previous.warmup === set.warmup && previous.target === target && previous.load === load) previous.count++;
    else lines.push({ count: 1, warmup: set.warmup, target, load });
  }
  return lines;
}
