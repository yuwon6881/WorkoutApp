import type { Exercise, LoggedSet, Session, SessionExercise, SetPrescription, Unit } from '../types';
import { defaultLoadStepKg } from './training';
import { loadEntryFor } from './resistanceVariant';
import { isTimedExercise } from './setDuration';
import { effortPatch, effortValue, loadIsEditable } from './workoutDraft';
import { setKind } from './workoutSetTypes';

/// The loads a piece of equipment can actually be set to: a weight list, else multiples of a step.
export type LoadGrid = { stepKg: number; availableLoadsKg: number[] | null };

export function exerciseLoadGrid(exercise: SessionExercise, catalog: Exercise[], unit: Unit): LoadGrid {
  const library = catalog.find(item => item.id === exercise.exerciseId);
  return { stepKg: library?.loadStepKg ?? defaultLoadStepKg(unit), availableLoadsKg: library?.availableLoadsKg ?? null };
}

/// What the logger last wrote into a set's inputs for the lifter, so a later adjustment can tell
/// its own fill from something the lifter typed.
export type FilledInputs = { weightKg: number | null; reps: number | null; rpe: number | null; rir: string | null };
export type FilledInputsLog = Map<string, FilledInputs>;

/** A result edit and the following straight-set adjustments form one draft change. */
export function withLoggedSetEdit(draft: Session, ei: number, si: number, patch: Partial<LoggedSet>,
  catalog: Exercise[], unit: Unit, trackRir: boolean, filled: FilledInputsLog): Session | null {
  const exercise = draft.exercises[ei];
  if (!exercise?.sets[si] || ('weightKg' in patch && !loadIsEditable(exercise))) return null;
  const edited = { ...draft, exercises: draft.exercises.map((item, index) => index === ei
    ? { ...item, sets: item.sets.map((set, setIndex) => setIndex === si ? { ...set, ...patch } : set) } : item) };
  const isResult = patch.done === true || 'weightKg' in patch || 'reps' in patch || 'rpe' in patch || 'rir' in patch;
  return isResult ? withLiveAdjustment(edited, ei, si, exerciseLoadGrid(exercise, catalog, unit), trackRir, filled) : edited;
}

const DEFAULT_RESERVE = 2;
/// How many reps a logged set must be off the plan, at the planned load, before the sets after it
/// follow it. A single rep either way is ordinary set-to-set variation.
const REP_DEVIATION = 2;
const EPSILON = 1e-6;

/// The reserve a program aims for, read the way the server does: the printed reserve (a range or a
/// floor counts by its harder end), else 10 − RPE, else the default the logger names.
export function targetReserve(plan: SetPrescription | undefined): number {
  const text = plan?.rir?.trim();
  if (text === '5+') return 5;
  const range = text?.match(/^(\d+(?:\.\d+)?)\s*(?:(?:-|–|—|to)\s*(\d+(?:\.\d+)?)|\+)?$/i);
  if (range) return Math.min(Number(range[1]), range[2] === undefined ? Infinity : Number(range[2]));
  return plan?.targetRpe != null ? Math.max(0, 10 - plan.targetRpe) : DEFAULT_RESERVE;
}

const inputsOf = (set: LoggedSet): FilledInputs => ({
  weightKg: set.weightKg, reps: set.reps, rpe: set.rpe, rir: set.rir ?? null
});
const sameLoadAndReps = (left: FilledInputs, right: FilledInputs) =>
  (left.weightKg === null ? right.weightKg === null : right.weightKg !== null && Math.abs(left.weightKg - right.weightKg) < 1e-4) &&
  left.reps === right.reps;
const sameInputs = (left: FilledInputs, right: FilledInputs) =>
  sameLoadAndReps(left, right) && left.rpe === right.rpe && left.rir === right.rir;
/// A set whose effort is still blank has none the lifter typed, so a workout started before effort
/// was prefilled still counts as holding the fill.
const holds = (current: FilledInputs, fill: FilledInputs) =>
  sameInputs(current, fill) || (sameLoadAndReps(current, fill) && current.rpe === null && current.rir === null);

/// What the sets began with: the server's prefill (the suggestion's load and reps, the program's
/// reserve). A set still holding it, or still holding what an adjustment wrote, is the app's to move.
function baseInputs(set: LoggedSet, plan: SetPrescription | undefined, trackRir: boolean): FilledInputs | null {
  const suggestion = set.suggestion;
  if (!suggestion || (!suggestion.sourceSessionId && !suggestion.sourceDate)) return null;
  const effort = trackRir ? effortPatch(Math.round(targetReserve(plan))) : { rpe: null, rir: null };
  return { weightKg: suggestion.suggestedLoadKg, reps: suggestion.suggestedReps, rpe: effort.rpe, rir: effort.rir ?? null };
}

const roundToGrid = (value: number, grid: LoadGrid, mode: 'floor' | 'nearest'): number => {
  if (grid.availableLoadsKg?.length) {
    const loads = [...grid.availableLoadsKg].sort((a, b) => a - b);
    if (mode === 'floor') return [...loads].reverse().find(load => load <= value + EPSILON) ?? loads[0];
    return loads.reduce((best, load) => Math.abs(load - value) < Math.abs(best - value) ? load : best, loads[0]);
  }
  if (grid.stepKg <= 0) return value;
  const steps = value / grid.stepKg;
  // The equipment cannot be set below its smallest step, and a zero load would make capacity / load infinite.
  const whole = Math.max(1, mode === 'floor' ? Math.floor(steps + EPSILON) : Math.round(steps));
  return Number((grid.stepKg * whole).toFixed(4));
};

type Plan = { low: number; high: number; goal: number };

/// The rep range a straight working set aims for, null when it states no rep count to steer by.
function repPlan(plan: SetPrescription | undefined): Plan | null {
  if (!plan || plan.warmup || plan.repMin == null || plan.repMin <= 0) return null;
  const high = plan.repMax != null && plan.repMax >= plan.repMin ? plan.repMax : plan.repMin;
  return { low: plan.repMin, high, goal: targetReserve(plan) };
}

const isStraightWorking = (exercise: SessionExercise, index: number) =>
  setKind(exercise.sets[index], exercise.prescription[index]) === 'straight';

/// How the lifter's capacity that day compares with what the plan for that set assumed, as a
/// ratio of load × (reps + reserve + 30): above 1 the set was easier than planned, below 1 harder.
/// Null when the set cannot say (no history-based plan, no reps, or no rep target).
function capacityRatio(set: LoggedSet, plan: SetPrescription | undefined, loadMatters: boolean, trackRir: boolean): number | null {
  const suggestion = set.suggestion;
  const target = repPlan(plan);
  if (!suggestion || !target || set.reps === null || set.reps <= 0 || (!suggestion.sourceSessionId && !suggestion.sourceDate)) return null;
  const planned = suggestion.suggestedReps;
  const reserve = trackRir ? effortValue(set) ?? target.goal : target.goal;
  const actual = set.reps + reserve + 30;
  const intended = planned + target.goal + 30;
  if (!loadMatters) return actual / intended;
  if (set.weightKg === null || suggestion.suggestedLoadKg === null || set.weightKg <= 0 || suggestion.suggestedLoadKg <= 0) return null;
  return (set.weightKg * actual) / (suggestion.suggestedLoadKg * intended);
}

/// The load, reps and reserve a later set should start with given today's capacity ratio.
function adjustedInputs(
  base: FilledInputs, plan: SetPrescription | undefined, ratio: number, grid: LoadGrid, loadMatters: boolean, trackRir: boolean
): FilledInputs | null {
  const target = repPlan(plan);
  if (!target || base.reps === null) return null;
  const plannedReps = Math.min(target.high, Math.max(target.low, base.reps));
  const plannedCapacity = plannedReps + target.goal + 30;
  const capacity = plannedCapacity * ratio; // in reps-plus-reserve units at the planned load
  const exact = target.low === target.high;
  const repsAtPlannedLoad = capacity - 30 - target.goal;
  let load = base.weightKg;
  let reps: number;

  if (!loadMatters || load === null || load <= 0) {
    reps = Math.min(target.high, Math.max(target.low, Math.round(repsAtPlannedLoad)));
  } else {
    // The same lift moves the load whose reps land in range: capacity / load = reps + reserve + 30.
    const loadCapacity = load * capacity;
    const loadFor = (repsWanted: number) => loadCapacity / (repsWanted + target.goal + 30);
    const rounded = Math.round(repsAtPlannedLoad);
    if (exact) load = roundToGrid(loadFor(target.low), grid, 'nearest');
    else if (rounded < target.low) load = Math.min(load, roundToGrid(loadFor(target.low), grid, 'floor'));
    else if (rounded > target.high) load = Math.max(load, roundToGrid(loadFor(plannedReps), grid, 'floor'));
    const repsAtLoad = loadCapacity / load - 30 - target.goal;
    reps = Math.min(target.high, Math.max(target.low, Math.round(exact ? target.low : repsAtLoad)));
  }

  // Say honestly what effort the new load and reps leave, instead of repeating the plan's reserve.
  let reserve = Math.round(target.goal);
  if (trackRir) {
    const loadScale = loadMatters && load !== null && base.weightKg ? base.weightKg / load : 1;
    const expected = capacity * loadScale - 30 - reps;
    if (Number.isFinite(expected) && Math.abs(expected - target.goal) >= 1) reserve = Math.min(5, Math.max(0, Math.round(expected)));
  }
  const effort = trackRir ? effortPatch(reserve) : { rpe: base.rpe, rir: base.rir };
  return { weightKg: load, reps, rpe: effort.rpe, rir: effort.rir ?? null };
}

/// Re-aims the unlogged straight sets after a set the lifter has just logged (or corrected) when
/// that set landed far enough from its plan. A much harder or easier set moves the load, reps and
/// reserve the following sets are filled with; a set back on plan returns them to where the program
/// started them. A set the lifter has typed into is theirs and is never overwritten, and warm-ups,
/// techniques, holds and exercises with no history to start from are left alone.
export function withLiveAdjustment(
  draft: Session, exerciseIndex: number, setIndex: number, grid: LoadGrid, trackRir: boolean, filled: FilledInputsLog
): Session {
  const exercise = draft.exercises[exerciseIndex];
  const logged = exercise?.sets[setIndex];
  if (!exercise || !logged?.done || logged.warmup || isTimedExercise(exercise) || !isStraightWorking(exercise, setIndex)) return draft;
  const entry = loadEntryFor(exercise);
  const loadMatters = entry === 'external';
  const ratio = capacityRatio(logged, exercise.prescription[setIndex], loadMatters, trackRir);
  if (ratio === null) return draft;
  const target = repPlan(exercise.prescription[setIndex]);
  const plannedReps = logged.suggestion?.suggestedReps ?? 0;
  const deviation = target ? (plannedReps + target.goal + 30) * (ratio - 1) : 0;
  const deviates = Math.abs(deviation) >= REP_DEVIATION - EPSILON;

  let changed = false;
  const sets = exercise.sets.map((set, index) => {
    if (index <= setIndex || set.done || set.warmup || !isStraightWorking(exercise, index)) return set;
    const plan = exercise.prescription[index];
    const base = baseInputs(set, plan, trackRir);
    if (!base) return set;
    const current = inputsOf(set);
    const lastFilled = filled.get(set.id);
    // Only a set still holding the program's fill, or the last adjustment's, is the app's to move.
    if (!holds(current, base) && !(lastFilled && holds(current, lastFilled))) return set;
    const next = deviates ? adjustedInputs(base, plan, ratio, grid, loadMatters, trackRir) : base;
    if (!next || sameInputs(next, current)) return set;
    filled.set(set.id, next);
    changed = true;
    return { ...set, weightKg: next.weightKg, reps: next.reps, rpe: next.rpe, rir: next.rir };
  });
  if (!changed) return draft;
  return { ...draft, exercises: draft.exercises.map((item, index) => index === exerciseIndex ? { ...item, sets } : item) };
}
