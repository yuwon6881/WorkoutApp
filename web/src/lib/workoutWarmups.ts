import type { Exercise, LoggedSet, Session, SessionExercise, SetPrescription, Unit } from '../types';
import { exerciseLoadGrid } from './liveAdjustment';
import { loadEntryFor } from './resistanceVariant';
import { isTimedExercise } from './setDuration';
import { blankPrescription, loadIsEditable } from './workoutDraft';
import { recommendedWarmupCount, warmupSteps, type WarmupContext, type WarmupStep } from './warmupPlan';

const MAX_SETS = 24;
const WARMUP_REST_SECONDS = 60;

/// What the warm-up button can do for one exercise right now.
export type WarmupOffer = {
  /// Warm-ups the plan already has (the leading block), and how many the working load calls for.
  existing: number;
  recommended: number;
  /// The working load the ramp builds to, or null when it is not entered yet.
  workingKg: number | null;
  steps: (count: number) => WarmupStep[];
};

const isWarmup = (exercise: SessionExercise, index: number) =>
  Boolean(exercise.sets[index]?.warmup || exercise.prescription[index]?.warmup);

function leadingWarmups(exercise: SessionExercise): number {
  let count = 0;
  while (count < exercise.sets.length && isWarmup(exercise, count)) count += 1;
  return count;
}

/**
 * Whether warm-ups can be filled or added: not for timed holds, reps-only or assisted movements,
 * and not once a working set or every warm-up is logged, when ramping up again would be too late.
 */
export function warmupOffer(draft: Session, exerciseIndex: number, catalog: Exercise[], unit: Unit): WarmupOffer | null {
  const exercise = draft.exercises[exerciseIndex];
  if (!exercise || isTimedExercise(exercise) || !loadIsEditable(exercise)) return null;
  const entry = loadEntryFor(exercise);
  if (entry === 'none' || entry === 'assistance') return null;
  const existing = leadingWarmups(exercise);
  const working = exercise.sets.slice(existing);
  if (!working.length || working.some(set => set.done)) return null;
  const open = exercise.sets.slice(0, existing).filter(set => !set.done);
  if (existing > 0 && !open.length) return null;
  const library = catalog.find(item => item.id === exercise.exerciseId);
  const workingKg = working[0].weightKg;
  const context: WarmupContext | null = workingKg === null ? null : {
    workingKg, entry, unit,
    equipment: library?.equipment ?? '', muscle: library?.muscle ?? '',
    perSide: exercise.weightBasis === 'per_side',
    bodyweightKg: draft.bodyWeight?.referenceKg ?? null,
    grid: exerciseLoadGrid(exercise, catalog, unit)
  };
  const recommended = context ? recommendedWarmupCount(context) : 0;
  // Planned warm-ups that are already filled leave nothing to do unless the ramp should grow.
  const fillable = open.some(set => set.weightKg === null || set.reps === null);
  if (existing > 0 && context && !fillable && existing >= recommended) return null;
  return {
    existing, workingKg, recommended,
    steps: count => context ? warmupSteps(context, count) : []
  };
}

function warmupPlan(reps: number, base: SetPrescription | undefined, exercise: SessionExercise): SetPrescription {
  return {
    ...blankPrescription(WARMUP_REST_SECONDS, exercise.loadModel, exercise.name),
    repMin: reps, repMax: reps, targetRpe: null, rir: null, warmup: true,
    resistanceMode: base?.resistanceMode
  };
}

/**
 * Applies a warm-up ramp, lightest first. Missing warm-ups are added at the front so the ramp stays
 * a leading block; existing warm-ups keep their place and only their empty load and reps are filled,
 * so a value the lifter typed or a warm-up already logged is never replaced. Nothing is added past
 * the set limit.
 */
export function withWarmups(draft: Session, exerciseIndex: number, steps: WarmupStep[]): Session {
  const exercise = draft.exercises[exerciseIndex];
  if (!exercise || !steps.length) return draft;
  const existing = leadingWarmups(exercise);
  const adding = Math.max(0, Math.min(steps.length - existing, MAX_SETS - exercise.sets.length));
  const first = exercise.sets[0];
  const added: LoggedSet[] = Array.from({ length: adding }, () => ({
    id: crypto.randomUUID(), position: 0, weightKg: null, reps: null, rpe: null, rir: null,
    done: false, warmup: true, resistanceMode: first?.resistanceMode
  }));
  const addedPlans = steps.slice(0, adding).map(step => warmupPlan(step.reps, exercise.prescription[0], exercise));
  const sets = [...added, ...exercise.sets];
  const prescription = [...addedPlans, ...exercise.prescription];
  const ramp = steps.slice(Math.max(0, steps.length - (adding + existing)));
  const filled = sets.map((set, index) => {
    const step = ramp[index];
    if (!step || index >= adding + existing || set.done) return { ...set, position: index };
    return { ...set, position: index, weightKg: set.weightKg ?? step.weightKg, reps: set.reps ?? step.reps };
  });
  return {
    ...draft,
    exercises: draft.exercises.map((item, index) => index === exerciseIndex ? { ...item, sets: filled, prescription } : item)
  };
}
