import type { LoggedSet, SessionExercise, SetPrescription, Unit } from '../types';
import { showReps, showRepEffortTarget, showTarget, targetRirLabel } from './training';
import { isTimedExercise, showTimedTarget } from './setDuration';
import { loadEntryFor, loadSign } from './resistanceVariant';
import { showExerciseWeight } from './weightBasis';

/// What one set aims for: its reps and effort, the load beneath it, and why. The load is null when
/// there is none to show; the reason is null when the plan alone sets the target.
export type SetTarget = { reps: string; load: string | null; reason: string | null };

// Mirrors the server's Progression.HasOpenReps: an "AMRAP" or "max reps" set with no count.
const OPEN_REPS = /\b(?:amrap|max(?:imum)?\s+reps?|to\s+failure|failure)\b/i;
const hasOpenReps = (plan: SetPrescription): boolean =>
  !!plan.repsText?.trim() && OPEN_REPS.test(plan.repsText) && !/\d/.test(plan.repsText);

/// The set's target as the progression set it when the workout started: the load and reps the
/// inputs were filled with, at the program's effort. It is fixed for the session; logging other
/// sets never moves it. A first time, a set added mid-workout, a warm-up or a hold shows the plan's
/// own target instead, and a set with no rep count never shows an invented one.
export function setTarget(
  set: LoggedSet,
  plan: SetPrescription | undefined,
  exercise: Pick<SessionExercise, 'name' | 'loadModel' | 'trackingMode' | 'weightBasis'>,
  unit: Unit,
  trackRir: boolean
): SetTarget {
  if (!plan) return { reps: '—', load: null, reason: null };
  if (isTimedExercise(exercise)) return { reps: showTimedTarget(plan), load: null, reason: null };
  if (plan.warmup || set.warmup) return { reps: showReps(plan), load: null, reason: null };

  const suggestion = set.suggestion;
  const reason = suggestion?.reason ?? null;
  if (!suggestion || (!suggestion.sourceSessionId && !suggestion.sourceDate)) {
    return { reps: showTarget(plan, trackRir), load: null, reason };
  }

  const open = plan.repMin === null || hasOpenReps(plan);
  const reps = open ? showReps(plan) : String(suggestion.suggestedReps);
  const effort = trackRir ? targetRirLabel(plan) : null;
  const entry = loadEntryFor(exercise);
  const load = suggestion.suggestedLoadKg !== null && entry !== 'bodyweight' && entry !== 'none'
    ? `${loadSign(entry)}${showExerciseWeight(suggestion.suggestedLoadKg, unit, exercise)}`
    : null;
  return { reps: showRepEffortTarget(reps, effort), load, reason };
}
