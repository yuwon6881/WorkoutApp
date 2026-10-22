import type { Exercise, LoggedSet, Session, SessionExercise, SetPrescription, Unit } from '../types';
import { defaultLoadStepKg } from './training';
import { loadEntryFor } from './resistanceVariant';
import { isTimedExercise } from './setDuration';
import { effortPatch, effortValue, loadIsEditable } from './workoutDraft';
import { setKind } from './workoutSetTypes';
import { hasOpenReps } from './setTarget';

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
const EPSILON = 1e-6;
/// The steepest drop from one set to the next the session's trend is allowed to project, in reps.
const MAX_DROP_PER_SET = 3;
/// How far either side of the planned load the next sets may move, in grid steps.
const LOAD_REACH_STEPS = 8;

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

type Plan = { low: number; high: number; goal: number };

/// The rep range a straight working set aims for, null when it states no rep count to steer by
/// (an AMRAP set's stored one-rep bound is a placeholder, not a target).
function repPlan(plan: SetPrescription | undefined): Plan | null {
  if (!plan || plan.warmup || plan.repMin == null || plan.repMin <= 0 || hasOpenReps(plan)) return null;
  const high = plan.repMax != null && plan.repMax >= plan.repMin ? plan.repMax : plan.repMin;
  return { low: plan.repMin, high, goal: targetReserve(plan) };
}

const isStraightWorking = (exercise: SessionExercise, index: number) =>
  setKind(exercise.sets[index], exercise.prescription[index]) === 'straight';

/// How many reps the lifter could have done at a set's planned load, from what they logged:
/// load × (reps + reserve + 30) is held constant across loads, as the server's progression reads it.
function repsToFailureAtPlan(set: LoggedSet, goal: number, loadMatters: boolean, trackRir: boolean): number | null {
  const suggestion = set.suggestion;
  if (!suggestion || set.reps === null || set.reps <= 0) return null;
  const reserve = trackRir ? effortValue(set) ?? goal : goal;
  if (!loadMatters) return set.reps + reserve;
  if (set.weightKg === null || suggestion.suggestedLoadKg === null || set.weightKg <= 0 || suggestion.suggestedLoadKg <= 0) return null;
  return (set.weightKg * (set.reps + reserve + 30)) / suggestion.suggestedLoadKg - 30;
}

type Deviation = { position: number; reps: number };

/// How far each logged straight set landed from its own plan, in reps to failure at its planned
/// load, ordered by the set's place among the straight working sets.
function loggedDeviations(exercise: SessionExercise, loadMatters: boolean, trackRir: boolean): Deviation[] {
  const deviations: Deviation[] = [];
  let position = 0;
  exercise.sets.forEach((set, index) => {
    if (set.warmup || !isStraightWorking(exercise, index)) return;
    const plan = exercise.prescription[index];
    const target = repPlan(plan);
    const base = target && baseInputs(set, plan, trackRir);
    const actual = set.done && target ? repsToFailureAtPlan(set, target.goal, loadMatters, trackRir) : null;
    if (target && base?.reps != null && actual !== null) {
      const planned = clampReps(base.reps, target) + target.goal;
      deviations.push({ position, reps: actual - planned });
    }
    position += 1;
  });
  return deviations;
}

/// The session's own fatigue trend: the least-squares change in deviation per set. A session that
/// is fading faster than the plan projects that fade forward; one getting easier is not assumed to
/// keep getting easier, and a single logged set has no trend yet.
function deviationTrend(deviations: Deviation[]): number {
  if (deviations.length < 2) return 0;
  const meanPosition = deviations.reduce((sum, item) => sum + item.position, 0) / deviations.length;
  const meanReps = deviations.reduce((sum, item) => sum + item.reps, 0) / deviations.length;
  const spread = deviations.reduce((sum, item) => sum + (item.position - meanPosition) ** 2, 0);
  if (spread <= EPSILON) return 0;
  const slope = deviations.reduce((sum, item) => sum + (item.position - meanPosition) * (item.reps - meanReps), 0) / spread;
  return Math.max(-MAX_DROP_PER_SET, Math.min(0, slope));
}

const clampReps = (reps: number, target: Plan) => Math.min(target.high, Math.max(target.low, reps));

/// The loads the next set may be set to near its planned load: the weight list's entries within
/// reach, else whole steps either side, never zero or below.
function candidateLoads(planned: number, grid: LoadGrid): number[] {
  const loads = grid.availableLoadsKg?.length
    ? grid.availableLoadsKg.filter(load => load > 0 && Math.abs(load - planned) <= LOAD_REACH_STEPS * Math.max(grid.stepKg, planned * 0.05))
    : Array.from({ length: LOAD_REACH_STEPS * 2 + 1 }, (_, i) => Number((planned + (i - LOAD_REACH_STEPS) * grid.stepKg).toFixed(4)))
      .filter(load => load > EPSILON);
  return [planned, ...loads.filter(load => Math.abs(load - planned) > EPSILON)];
}

/// The load, reps and reserve closest to a set's target given the reps to failure projected at its
/// planned load. Each option costs its distance from the plan in reps: reps short of the range, a
/// reserve away from the target, and a changed load by the reps that change is worth. So a set a
/// rep short keeps its load when a step lighter would cost more than that rep, and a small step
/// wins when it lands the set back in range for less.
function aimedInputs(
  base: FilledInputs, plan: SetPrescription | undefined, projected: number, grid: LoadGrid, loadMatters: boolean, trackRir: boolean
): FilledInputs | null {
  const target = repPlan(plan);
  if (!target || base.reps === null) return null;
  const goal = Math.round(target.goal);
  const planned = base.weightKg;
  // Equipment with no increment and no weight list progresses through reps alone, so its load stays put.
  const loadMoves = loadMatters && planned !== null && planned > 0 && (!!grid.availableLoadsKg?.length || grid.stepKg > 0);
  const loads = loadMoves ? candidateLoads(planned, grid) : [planned];

  let best: { load: number | null; reps: number; reserve: number; cost: number } | null = null;
  for (const load of loads) {
    const toFailure = load !== null && planned !== null && load !== planned
      ? (planned * (projected + 30)) / load - 30
      : projected;
    // Never past failure: a set that cannot reach the range keeps the target effort with fewer reps.
    const reps = Math.max(1, Math.min(target.high, Math.round(toFailure - target.goal)));
    const reserve = Math.min(5, Math.max(0, Math.round(toFailure - reps)));
    const cost = Math.abs(toFailure - projected) + Math.max(0, target.low - reps) + Math.abs(reserve - goal);
    if (!best || cost < best.cost - EPSILON) best = { load, reps, reserve, cost };
  }
  if (!best) return null;
  if (best.load === planned && best.reps === base.reps && best.reserve === goal) return base;
  const effort = trackRir ? effortPatch(best.reserve) : { rpe: base.rpe, rir: base.rir };
  return { weightKg: best.load, reps: best.reps, rpe: effort.rpe, rir: effort.rir ?? null };
}

/// Re-aims every unlogged straight set each time a set is logged (or corrected). Each logged set
/// says how far the lifter is from the plan today, and their trend across the session (a fade
/// faster than planned) is carried forward, so a lifter who went 2 RIR then 1 RIR at the same reps
/// is shown one rep fewer next, then another fewer, or a lighter load where that is closer to the
/// target. Sets back on plan return to where the program started them. A set the lifter has typed
/// into is theirs and is never overwritten, and warm-ups, techniques, holds and exercises with no
/// history to start from are left alone.
export function withLiveAdjustment(
  draft: Session, exerciseIndex: number, setIndex: number, grid: LoadGrid, trackRir: boolean, filled: FilledInputsLog
): Session {
  const exercise = draft.exercises[exerciseIndex];
  const logged = exercise?.sets[setIndex];
  if (!exercise || !logged?.done || logged.warmup || isTimedExercise(exercise) || !isStraightWorking(exercise, setIndex)) return draft;
  const loadMatters = loadEntryFor(exercise) === 'external';
  const deviations = loggedDeviations(exercise, loadMatters, trackRir);
  const last = deviations.at(-1);
  if (!last) return draft;
  const trend = deviationTrend(deviations);

  let changed = false;
  let position = 0;
  const sets = exercise.sets.map((set, index) => {
    if (set.warmup || !isStraightWorking(exercise, index)) return set;
    const place = position;
    position += 1;
    if (set.done) return set;
    const plan = exercise.prescription[index];
    const target = repPlan(plan);
    const base = baseInputs(set, plan, trackRir);
    if (!target || !base || base.reps === null) return set;
    const current = inputsOf(set);
    const lastFilled = filled.get(set.id);
    // Only a set still holding the program's fill, or the last adjustment's, is the app's to move.
    if (!holds(current, base) && !(lastFilled && holds(current, lastFilled))) return set;
    const projected = clampReps(base.reps, target) + target.goal + last.reps + trend * (place - last.position);
    const next = aimedInputs(base, plan, projected, grid, loadMatters, trackRir);
    if (!next || sameInputs(next, current)) return set;
    filled.set(set.id, next);
    changed = true;
    return { ...set, weightKg: next.weightKg, reps: next.reps, rpe: next.rpe, rir: next.rir };
  });
  if (!changed) return draft;
  return { ...draft, exercises: draft.exercises.map((item, index) => index === exerciseIndex ? { ...item, sets } : item) };
}
