import type { SetPrescription } from '../types';
import { targetRirLabel } from './training';

const DEFAULT_RIR = 2;

/// The reps-in-reserve choices a printed target points at, for marking them on the effort chips:
/// "2" is 2, a range such as "1-2" is both ends and everything between, and a floor such as "1+"
/// is its number. Anything the chips cannot show (text, a value past 5+) marks nothing.
export function targetRirChoices(rir: string | null | undefined): number[] {
  const text = rir?.trim().replace('–', '-') ?? '';
  const range = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (range) {
    const low = Math.round(Number(range[1]));
    const high = Math.round(Number(range[2]));
    if (low > high || high > 5) return [];
    return Array.from({ length: high - low + 1 }, (_, offset) => low + offset);
  }
  const single = /^(\d+(?:\.\d+)?)\+?$/.exec(text);
  if (!single) return [];
  const value = Math.round(Number(single[1]));
  return value <= 5 ? [value] : [];
}

/// The effort a set's plan asks for, as chip choices: the printed RIR, else its RPE as RIR, else
/// the default 2 RIR the target column names for a working set that states none.
export function plannedRirChoices(plan: SetPrescription | undefined): number[] {
  if (!plan) return [];
  const label = targetRirLabel(plan);
  if (label) return targetRirChoices(label.replace(/\s*RIR$/, ''));
  return plan.warmup ? [] : [DEFAULT_RIR];
}
