import type { Exercise, LoggedSet, Session, SessionExercise, SetPrescription, Unit } from '../types';
import { defaultLoadStepKg } from './training';
import { loadEntryFor, type LoadEntry } from './resistanceVariant';
import { isTimedExercise } from './setDuration';
import { effortPatch, effortValue, loadIsEditable } from './workoutDraft';
import { setKind, type SetKind } from './workoutSetTypes';
import { hasOpenReps } from './setTarget';
import { aimedInputs, deviationTrend, loadAxisFor, type Deviation, type FilledInputs, type LoadGrid, type RepPlan } from './liveAdjustmentAim';

export type { FilledInputs, LoadGrid } from './liveAdjustmentAim';

export function exerciseLoadGrid(exercise: SessionExercise, catalog: Exercise[], unit: Unit): LoadGrid {
  const library = catalog.find(item => item.id === exercise.exerciseId);
  return { stepKg: library?.loadStepKg ?? defaultLoadStepKg(unit), availableLoadsKg: library?.availableLoadsKg ?? null };
}

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


/// The rep range a straight working set aims for, null when it states no rep count to steer by
/// (an AMRAP set's stored one-rep bound is a placeholder, not a target).
function repPlan(plan: SetPrescription | undefined): RepPlan | null {
  if (!plan || plan.warmup || plan.repMin == null || plan.repMin <= 0 || hasOpenReps(plan)) return null;
  const high = plan.repMax != null && plan.repMax >= plan.repMin ? plan.repMax : plan.repMin;
  return { low: plan.repMin, high, goal: targetReserve(plan) };
}

/// The weight actually moved for an entered load, used to compare a set lifted at another load
/// with its plan: the entry itself, or the session's frozen bodyweight plus added load or minus
/// assistance. Null when the load says nothing (plain bodyweight, reps-only, or no bodyweight).
function movedLoad(entry: LoadEntry, referenceKg: number | null | undefined, entered: number | null): number | null {
  if (entered === null) return null;
  if (entry === 'external') return entered > 0 ? entered : null;
  if (referenceKg == null || referenceKg <= 0) return null;
  if (entry === 'added') return referenceKg + entered;
  if (entry === 'assistance') return referenceKg - entered > 0 ? referenceKg - entered : null;
  return null;
}

type Reading = { entry: LoadEntry; referenceKg: number | null | undefined; trackRir: boolean };

/// How many reps the lifter could have done at a set's planned load, from what they logged:
/// load moved × (reps + reserve + 30) is held constant across loads, as the server reads it.
function repsToFailureAtPlan(set: LoggedSet, goal: number, reading: Reading): number | null {
  const suggestion = set.suggestion;
  if (!suggestion || set.reps === null || set.reps <= 0) return null;
  const reserve = reading.trackRir ? effortValue(set) ?? goal : goal;
  const actual = movedLoad(reading.entry, reading.referenceKg, set.weightKg);
  const planned = movedLoad(reading.entry, reading.referenceKg, suggestion.suggestedLoadKg);
  if (actual === null || planned === null) return set.reps + reserve;
  return (actual * (set.reps + reserve + 30)) / planned - 30;
}

const clampReps = (reps: number, target: RepPlan) => Math.min(target.high, Math.max(target.low, reps));

/// The working sets that can steer and be steered: not warm-ups, and with a rep target.
const steerable = (exercise: SessionExercise, index: number) => !exercise.sets[index].warmup && !exercise.prescription[index]?.warmup;

/// How far each logged set of every kind landed from its plan, each kind on its own (straight sets
/// with straight sets, each technique with the same technique), ordered by place within its kind.
function loggedDeviations(exercise: SessionExercise, reading: Reading): Map<SetKind, Deviation[]> {
  const byKind = new Map<SetKind, Deviation[]>();
  const places = new Map<SetKind, number>();
  exercise.sets.forEach((set, index) => {
    if (!steerable(exercise, index)) return;
    const kind = setKind(set, exercise.prescription[index]);
    const position = places.get(kind) ?? 0;
    places.set(kind, position + 1);
    const plan = exercise.prescription[index];
    const target = repPlan(plan);
    const base = target && baseInputs(set, plan, reading.trackRir);
    const actual = set.done && target ? repsToFailureAtPlan(set, target.goal, reading) : null;
    if (!target || base?.reps == null || actual === null) return;
    const list = byKind.get(kind) ?? [];
    list.push({ position, reps: actual - (clampReps(base.reps, target) + target.goal) });
    byKind.set(kind, list);
  });
  return byKind;
}

/// Re-aims every unlogged working set each time a set is logged (or corrected). Each kind of set
/// learns from the logged sets of its own kind: how far they landed from their plan today, and
/// their fade across the session (a drop faster than planned is carried forward), so a lifter who
/// went 2 RIR then 1 RIR at the same reps is shown one rep fewer next, then another fewer, or a
/// lighter load where that is closer to the target. A technique set with none of its kind logged
/// yet follows the load of the straight set before it, as the server starts it. Barbells and
/// machines, weighted and assisted bodyweight movements (through the session's frozen bodyweight),
/// and reps-only movements all take part; warm-ups and timed holds, which record no effort to read
/// a fade from, are left alone, as are a set the lifter has typed into and a first time with no
/// history.
export function withLiveAdjustment(
  draft: Session, exerciseIndex: number, setIndex: number, grid: LoadGrid, trackRir: boolean, filled: FilledInputsLog
): Session {
  const exercise = draft.exercises[exerciseIndex];
  const logged = exercise?.sets[setIndex];
  if (!exercise || !logged?.done || isTimedExercise(exercise) || !steerable(exercise, setIndex)) return draft;
  const entry = loadEntryFor(exercise);
  const reading: Reading = { entry, referenceKg: draft.bodyWeight?.referenceKg, trackRir };
  const axis = loadAxisFor(entry, reading.referenceKg, grid);
  const deviations = loggedDeviations(exercise, reading);
  const trends = new Map([...deviations].map(([kind, list]) => [kind, deviationTrend(list)]));

  let changed = false;
  const places = new Map<SetKind, number>();
  const sets: LoggedSet[] = [];
  exercise.sets.forEach((set, index) => {
    sets.push(set);
    if (!steerable(exercise, index)) return;
    const plan = exercise.prescription[index];
    const kind = setKind(set, plan);
    const place = places.get(kind) ?? 0;
    places.set(kind, place + 1);
    if (set.done) return;
    const target = repPlan(plan);
    const base = baseInputs(set, plan, trackRir);
    if (!target || !base || base.reps === null) return;
    const current = inputsOf(set);
    const lastFilled = filled.get(set.id);
    // Only a set still holding the program's fill, or the last adjustment's, is the app's to move.
    if (!holds(current, base) && !(lastFilled && holds(current, lastFilled))) return;
    const own = deviations.get(kind);
    const last = own?.at(-1);
    let next: FilledInputs | null;
    if (last) {
      const projected = clampReps(base.reps, target) + target.goal + last.reps + (trends.get(kind) ?? 0) * (place - last.position);
      next = aimedInputs(base, target, projected, axis, trackRir);
    } else {
      next = kind === 'straight' ? base : followStraightLoad(exercise, sets, index, base, trackRir);
    }
    if (!next || sameInputs(next, current)) return;
    filled.set(set.id, next);
    changed = true;
    sets[index] = { ...set, weightKg: next.weightKg, reps: next.reps, rpe: next.rpe, rir: next.rir };
  });
  if (!changed) return draft;
  return { ...draft, exercises: draft.exercises.map((item, index) => index === exerciseIndex ? { ...item, sets } : item) };
}

/// A technique set that starts at the load of the straight set before it keeps doing so when that
/// straight set was logged or re-aimed at another load; its own reps and effort stay as planned.
function followStraightLoad(exercise: SessionExercise, sets: LoggedSet[], index: number, base: FilledInputs, trackRir: boolean): FilledInputs | null {
  for (let before = index - 1; before >= 0; before -= 1) {
    if (!steerable(exercise, before) || setKind(exercise.sets[before], exercise.prescription[before]) !== 'straight') continue;
    const straightBase = baseInputs(exercise.sets[before], exercise.prescription[before], trackRir);
    const followed = straightBase?.weightKg != null && base.weightKg != null && Math.abs(straightBase.weightKg - base.weightKg) < 1e-4;
    if (!followed) return base;
    const load = sets[before].weightKg;
    return load === null ? base : { ...base, weightKg: load };
  }
  return base;
}
