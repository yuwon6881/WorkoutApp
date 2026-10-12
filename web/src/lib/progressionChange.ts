import type { SetProgressionSuggestion } from '../types';

/** What a set's suggestion changes from the exposure it was built from. */
export type ProgressionChange =
  | { kind: 'load-up' | 'load-down'; deltaKg: number }
  | { kind: 'reps-up' | 'reps-down'; deltaReps: number }
  | { kind: 'repeat' };

// Loads arrive as converted doubles; anything smaller than this is the same plate.
const SAME_LOAD_KG = 0.01;

/// Whether a suggestion adds weight, adds reps, repeats or eases off. A load change is the headline
/// even when the reps drop with it (a heavier load rebuilding from the bottom of the range). With no
/// previous exposure recorded — a first session, or a suggestion stored before the server kept it —
/// nothing is claimed.
export function progressionChange(suggestion: SetProgressionSuggestion | null | undefined): ProgressionChange | null {
  if (!suggestion || suggestion.previousReps == null) return null;
  const { suggestedLoadKg: next, previousLoadKg: before } = suggestion;
  if (next != null && before != null && Math.abs(next - before) >= SAME_LOAD_KG) {
    const deltaKg = Math.round(Math.abs(next - before) * 1000) / 1000;
    return { kind: next > before ? 'load-up' : 'load-down', deltaKg };
  }
  const deltaReps = suggestion.suggestedReps - suggestion.previousReps;
  if (deltaReps > 0) return { kind: 'reps-up', deltaReps };
  if (deltaReps < 0) return { kind: 'reps-down', deltaReps: -deltaReps };
  return { kind: 'repeat' };
}
