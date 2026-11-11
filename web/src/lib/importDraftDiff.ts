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

/// A saved draft with every day (and exercise) the lifter did not change handed back as the very
/// object already on screen. The server answers each save with the whole program as fresh objects,
/// which would re-render every day for the sake of one edit; identity is only ever reused for
/// content that is exactly equal, so what is shown never differs from what the server returned.
export function shareUnchangedDays(previous: ImportDraft | null, saved: ImportDraft): ImportDraft {
  if (!previous) return saved;
  const before = new Map(previous.workouts.map(day => [day.lineId, day]));
  let reused = 0;
  const workouts = saved.workouts.map(day => {
    const old = before.get(day.lineId);
    if (!old) return day;
    if (old === day || JSON.stringify(old) === JSON.stringify(day)) {
      reused++;
      return old;
    }
    const oldExercises = new Map(old.exercises.map(exercise => [exercise.lineId, exercise]));
    const exercises = day.exercises.map(exercise => {
      const prior = oldExercises.get(exercise.lineId);
      return prior && JSON.stringify(prior) === JSON.stringify(exercise) ? prior : exercise;
    });
    return { ...day, exercises };
  });
  const sameOrder = reused === saved.workouts.length && previous.workouts.length === saved.workouts.length
    && workouts.every((day, index) => day === previous.workouts[index]);
  if (sameOrder && JSON.stringify({ ...previous, workouts: [] }) === JSON.stringify({ ...saved, workouts: [] })) return previous;
  return { ...saved, workouts };
}
