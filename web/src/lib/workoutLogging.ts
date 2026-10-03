import type { LoggedSet, Session, SessionExercise, Unit } from '../types';
import { showWeight } from './training';
import { findNextStep } from './restRules';
import { getSupersetGroup } from './supersets';
import { loadIsEditable, nextPendingSet, setNumberLabel } from './workoutDraft';
import { isTimedExercise, showSetDuration } from './setDuration';

// "60 kg × 8", "BW × 12", or just the reps when the load is still unknown.
export function setSummary(exercise: SessionExercise, set: LoggedSet, unit: Unit): string {
  if (isTimedExercise(exercise)) {
    const time = set.durationSeconds == null ? '' : showSetDuration(set.durationSeconds);
    if (set.weightKg === null || !loadIsEditable(exercise, set)) return time;
    return time ? `${showWeight(set.weightKg, unit)} · ${time}` : showWeight(set.weightKg, unit);
  }
  const reps = set.reps === null ? '' : `× ${set.reps}`;
  if (!loadIsEditable(exercise, set)) return set.reps === null ? '' : `BW ${reps}`;
  if (set.weightKg === null) return set.reps === null ? '' : `${set.reps} reps`;
  return `${showWeight(set.weightKg, unit)} ${reps}`.trim();
}

// A workout opens on the first exercise with a set still to log, or the first one when all are done.
export function firstOpenExercise(session: Session): number {
  const open = session.exercises.findIndex(exercise => exercise.sets.some(set => !set.done));
  return open >= 0 ? open : 0;
}

export type AdvanceOptions = { nextExercise: boolean; supersetPartner: boolean };

// After a set is logged, the view moves on when the next step belongs to another exercise: the
// next exercise once this one is complete, or the partner in a superset after every set. Each
// kind of move is its own device setting, so a lifter can keep one without the other.
export function advanceTarget(
  draft: Session,
  exerciseIndex: number,
  setIndex: number,
  options: AdvanceOptions = { nextExercise: true, supersetPartner: true }
): number | null {
  const step = findNextStep(draft.exercises, exerciseIndex, setIndex);
  if (!step) return null;
  const target = draft.exercises.findIndex(exercise => exercise.id === step.exercise.id);
  if (target < 0 || target === exerciseIndex) return null;
  const group = getSupersetGroup(draft.exercises[exerciseIndex].sequenceGroup);
  const partner = Boolean(group) && getSupersetGroup(step.exercise.sequenceGroup) === group;
  return (partner ? options.supersetPartner : options.nextExercise) ? target : null;
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
