import type { DraftSet, SetPrescription } from '../types';
import { showTarget } from './training';

export type SetSummaryLine = { count: number; warmup: boolean; target: string };

/// Collapses consecutive sets that ask for the same thing into one "3 × 8–10 · 2 RIR" line, so a
/// read-only day reads like the printed program rather than a row per set.
export function summarizeSets(sets: (SetPrescription | DraftSet)[], trackRir: boolean): SetSummaryLine[] {
  const lines: SetSummaryLine[] = [];
  for (const set of sets) {
    const target = showTarget(set, trackRir && !set.warmup);
    const previous = lines.at(-1);
    if (previous && previous.warmup === set.warmup && previous.target === target) previous.count++;
    else lines.push({ count: 1, warmup: set.warmup, target });
  }
  return lines;
}
