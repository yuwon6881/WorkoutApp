import type { LoggedSet, Session, SessionExercise, Unit } from '../types';
import { showWeight } from './training';
import { findNextStep } from './restRules';
import { loadIsEditable, nextPendingSet, setNumberLabel } from './workoutDraft';

export type NextLog = { exerciseIndex: number; setIndex: number; label: string; detail: string; ariaLabel: string };

// "60 kg × 8", "BW × 12", or just the reps when the load is still unknown.
export function setSummary(exercise: SessionExercise, set: LoggedSet, unit: Unit): string {
  const reps = set.reps === null ? '' : `× ${set.reps}`;
  if (!loadIsEditable(exercise, set)) return set.reps === null ? '' : `BW ${reps}`;
  if (set.weightKg === null) return set.reps === null ? '' : `${set.reps} reps`;
  return `${showWeight(set.weightKg, unit)} ${reps}`.trim();
}

// The footer's primary action logs the first set still open in the exercise on screen.
export function nextLog(draft: Session, exerciseIndex: number, unit: Unit): NextLog | null {
  const exercise = draft.exercises[exerciseIndex];
  const setIndex = nextPendingSet(exercise);
  if (!exercise || setIndex < 0) return null;
  const { label, warmup } = setNumberLabel(exercise, setIndex);
  return {
    exerciseIndex,
    setIndex,
    label: warmup ? `Log warm-up ${label.slice(1)}` : `Log set ${label}`,
    detail: setSummary(exercise, exercise.sets[setIndex], unit),
    // Names the same set the row's own control names, so either can be found the same way.
    ariaLabel: `Log ${exercise.name} set ${setIndex + 1}`
  };
}

// After a set is logged, the view moves on when the next step belongs to another exercise: the
// next exercise once this one is complete, or the partner in a superset after every set.
export function advanceTarget(draft: Session, exerciseIndex: number, setIndex: number): number | null {
  const step = findNextStep(draft.exercises, exerciseIndex, setIndex);
  if (!step) return null;
  const target = draft.exercises.findIndex(exercise => exercise.id === step.exercise.id);
  return target >= 0 && target !== exerciseIndex ? target : null;
}

// What the rest leads into, shown under the countdown so the next plate change can start early.
export function nextUpText(draft: Session, exerciseIndex: number, unit: Unit): string | null {
  const exercise = draft.exercises[exerciseIndex];
  const pending = nextPendingSet(exercise);
  let target = pending >= 0 ? { exercise, setIndex: pending } : null;
  if (!target) {
    const next = draft.exercises.findIndex((item, index) => index > exerciseIndex && nextPendingSet(item) >= 0);
    const fallback = next >= 0 ? next : draft.exercises.findIndex(item => nextPendingSet(item) >= 0);
    if (fallback < 0) return null;
    target = { exercise: draft.exercises[fallback], setIndex: nextPendingSet(draft.exercises[fallback]) };
  }
  const { label, warmup } = setNumberLabel(target.exercise, target.setIndex);
  const summary = setSummary(target.exercise, target.exercise.sets[target.setIndex], unit);
  return `${target.exercise.name} · ${warmup ? `warm-up ${label.slice(1)}` : `set ${label}`}${summary ? ` · ${summary}` : ''}`;
}
