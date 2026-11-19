import type { Session, Unit } from '../types';
import { isTimedExercise } from './setDuration';
import { validateLoggedSet } from './validation';
import { effortValue, nextPendingSet, setNumberLabel } from './workoutDraft';
import { setSummary } from './workoutLogging';
import { weightUnit } from './weightBasis';

export type NativeSetCard = { token: string; title: string; values: string };

export function notificationSetTarget(draft: Session, exerciseIndex: number, unit: Unit, trackRir: boolean) {
  if (!draft.active || draft.pausedAt) return null;
  const exercise = draft.exercises[exerciseIndex];
  const setIndex = nextPendingSet(exercise);
  if (setIndex < 0 || isTimedExercise(exercise)) return null;
  const set = exercise.sets[setIndex];
  if (set.reps === null || validateLoggedSet({ ...set, done: true })) return null;

  const { label, warmup } = setNumberLabel(exercise, setIndex);
  const title = `${exercise.name} · ${warmup ? `Warm-up ${label.slice(1)}` : `Set ${label}`}`;
  const summary = setSummary(exercise, set, unit).replace(unit, weightUnit(unit, exercise));
  const rir = trackRir ? effortValue(set) : null;
  const values = rir === null ? summary : `${summary} · ${rir === 5 ? '5+' : rir} RIR`;
  // Include exact input values because their displayed equivalents may be rounded.
  const key = JSON.stringify([exercise.id, set.id, title, values, set.weightKg, set.reps, set.rir, set.rpe,
    set.durationSeconds, set.warmup, set.resistanceMode]);
  return { key, title, values, exerciseIndex, setIndex };
}
