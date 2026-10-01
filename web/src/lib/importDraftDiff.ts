import type { DraftWorkout, ImportDraft } from '../types';

/// The days an exercise edit changed, or null when the edit reshaped the draft itself (days added,
/// removed, reordered, or the program renamed) and only a whole-draft save describes it. Days are
/// compared by their exercises because that is all an exercise edit touches; structure ids the
/// editor fills in are carried along with any changed day but never make an untouched day "changed".
export function changedDraftDays(current: ImportDraft, next: ImportDraft): DraftWorkout[] | null {
  if (current.programName !== next.programName || current.workouts.length !== next.workouts.length) return null;
  const changed: DraftWorkout[] = [];
  for (let index = 0; index < next.workouts.length; index++) {
    const before = current.workouts[index];
    const after = next.workouts[index];
    if (before.lineId !== after.lineId) return null;
    if (before.exercises !== after.exercises && JSON.stringify(before.exercises) !== JSON.stringify(after.exercises))
      changed.push(after);
  }
  return changed;
}
