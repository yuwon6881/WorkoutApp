import type { LoggedSet, PreviousRepRecord, SessionExercise, Unit } from '../types';
import { calculateEstimated1Rm, toDisplay } from './training';
import { isStrengthSet } from './setTechnique';

export type LivePrResult = {
  kind: 'e1rm' | 'reps' | 'both';
  e1rm: number | null;
  reps: number | null;
  loadKg: number | null;
  isRepsOnly: boolean;
};

// The same rule the server uses when the workout is saved (WorkoutViewBuilder.ComputePrs): a
// working set's estimated 1RM, on system load for full-bodyweight movements, has to beat the
// best of every finished session. Here it must also beat the sets already logged today, so the
// lifter hears about each improvement once. Without finished history there is nothing to beat.
// Technique sets (partials, myo-reps, drop sets) are not straight-set strength, so they neither
// announce a record nor count as one, matching the server.
export function setEstimate(exercise: SessionExercise, set: LoggedSet): number | null {
  if (!isStrengthSet(exercise, set)) return null;
  const load = exercise.loadModel === 'full_bodyweight' ? set.systemLoadKg ?? set.weightKg : set.weightKg;
  return calculateEstimated1Rm(load, set.reps, set.rpe);
}

export function getLoadKey(exercise: SessionExercise, set: LoggedSet): {
  loadKey: string; comparableLoad: number | null; isRepsOnly: boolean; loadModel: string; resistanceMode: string;
} | null {
  const loadModel = exercise.loadModel ?? 'external';
  const resistanceMode = set.resistanceMode ?? (loadModel === 'full_bodyweight' ? 'bodyweight'
    : loadModel === 'reps_only' || loadModel === 'bodyweight_context_only' ? 'reps_only' : 'external');
  if (exercise.loadModel === 'full_bodyweight') {
    if (set.systemLoadKg == null) return null;
    const rounded = Number(set.systemLoadKg.toFixed(4));
    return { loadKey: JSON.stringify([loadModel, resistanceMode, rounded]), comparableLoad: set.systemLoadKg, isRepsOnly: false, loadModel, resistanceMode };
  }
  if (exercise.loadModel === 'reps_only' || exercise.loadModel === 'bodyweight_context_only') {
    return { loadKey: JSON.stringify([loadModel, resistanceMode, null]), comparableLoad: null, isRepsOnly: true, loadModel, resistanceMode };
  }
  if (set.weightKg === null) return null;
  const rounded = Number(set.weightKg.toFixed(4));
  return { loadKey: JSON.stringify([loadModel, resistanceMode, rounded]), comparableLoad: set.weightKg, isRepsOnly: false, loadModel, resistanceMode };
}

function previousRepBest(exercise: SessionExercise, current: NonNullable<ReturnType<typeof getLoadKey>>): number | undefined {
  return exercise.previousRepRecords?.find((record: PreviousRepRecord) =>
    record.loadModel === current.loadModel && record.resistanceMode === current.resistanceMode &&
    (record.loadKg === null ? current.comparableLoad === null
      : current.comparableLoad !== null && Math.abs(record.loadKg - current.comparableLoad) < 1e-4))?.reps;
}

export function checkLivePr(exercise: SessionExercise, setIndex: number): LivePrResult | null {
  const set = exercise.sets[setIndex];
  if (!set || !set.done || !isStrengthSet(exercise, set)) return null;

  // 1. Check e1RM PR
  let isE1rmPr = false;
  const estimate = setEstimate(exercise, set);
  if (exercise.previousBestE1rmKg != null && estimate !== null && estimate > exercise.previousBestE1rmKg + 1e-4) {
    const earlierEstimates = exercise.sets
      .filter((other, idx) => idx !== setIndex && other.done && !other.warmup)
      .map(other => setEstimate(exercise, other) ?? 0);
    if (!earlierEstimates.some(val => val >= estimate - 1e-4)) {
      isE1rmPr = true;
    }
  }

  // 2. Check Rep PR at same comparable load
  let isRepPr = false;
  const loadInfo = getLoadKey(exercise, set);
  if (loadInfo !== null && set.reps != null && set.reps > 0) {
    const prevRepBest = previousRepBest(exercise, loadInfo);
    if (prevRepBest !== undefined && set.reps > prevRepBest) {
      const earlierRepsAtLoad = exercise.sets
        .filter((other, idx) => idx !== setIndex && other.done && isStrengthSet(exercise, other))
        .filter(other => {
          const otherInfo = getLoadKey(exercise, other);
          return otherInfo !== null && otherInfo.loadKey === loadInfo.loadKey;
        })
        .map(other => other.reps ?? 0);
      if (!earlierRepsAtLoad.some(val => val >= set.reps!)) {
        isRepPr = true;
      }
    }
  }

  if (isE1rmPr && isRepPr) {
    return { kind: 'both', e1rm: estimate, reps: set.reps, loadKg: loadInfo?.comparableLoad ?? null, isRepsOnly: loadInfo?.isRepsOnly ?? false };
  }
  if (isE1rmPr) {
    return { kind: 'e1rm', e1rm: estimate, reps: null, loadKg: null, isRepsOnly: false };
  }
  if (isRepPr) {
    return { kind: 'reps', e1rm: null, reps: set.reps, loadKg: loadInfo?.comparableLoad ?? null, isRepsOnly: loadInfo?.isRepsOnly ?? false };
  }
  return null;
}

export function newBestAfterLogging(exercise: SessionExercise, setIndex: number): number | null {
  const pr = checkLivePr(exercise, setIndex);
  return pr && (pr.kind === 'e1rm' || pr.kind === 'both') ? pr.e1rm : null;
}

export function formatExercisePrBadge(exercise: SessionExercise, unit: Unit): string {
  if (exercise.prKind === 'reps') {
    return `Rep best${exercise.prReps != null ? ` · ${exercise.prReps} reps` : ''}`;
  }
  if (exercise.prKind === 'e1rm') {
    return `Estimated strength best${exercise.prE1rmKg != null ? ` · ${toDisplay(exercise.prE1rmKg, unit)} ${unit} e1RM` : ''}`;
  }
  if (exercise.prKind === 'both') {
    return `Strength & rep best${exercise.prE1rmKg != null ? ` · ${toDisplay(exercise.prE1rmKg, unit)} ${unit} e1RM` : ''}${exercise.prReps != null ? ` · ${exercise.prReps} reps` : ''}`;
  }
  return `PR${exercise.prE1rmKg != null ? ` · ${toDisplay(exercise.prE1rmKg, unit)} ${unit} e1RM` : ''}`;
}

export function formatSetPrTag(set: LoggedSet): string {
  if (set.prKind === 'reps') return 'Rep best';
  if (set.prKind === 'e1rm') return 'Estimated strength best';
  if (set.prKind === 'both') return 'Strength & rep best';
  return 'PR';
}
