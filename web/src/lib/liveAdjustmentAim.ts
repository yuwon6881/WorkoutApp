import { effortPatch } from './workoutDraft';
import type { LoadEntry } from './resistanceVariant';

/// The loads a piece of equipment can actually be set to: a weight list, else multiples of a step.
export type LoadGrid = { stepKg: number; availableLoadsKg: number[] | null };

/// What the logger last wrote into a set's inputs for the lifter, so a later adjustment can tell
/// its own fill from something the lifter typed.
export type FilledInputs = { weightKg: number | null; reps: number | null; rpe: number | null; rir: string | null };

/// The rep range a working set aims for and the reserve it aims to leave.
export type RepPlan = { low: number; high: number; goal: number };

/// How a set's entered load becomes the weight actually moved, and which entries the next set may
/// take. Barbells and machines move what is entered; a weighted bodyweight movement moves the
/// session's frozen bodyweight plus the added load, and an assisted one bodyweight minus the
/// assistance (so more assistance is a lighter set). Null when only reps can change: a plain
/// bodyweight or reps-only movement, equipment with no increment, or bodyweight with no reference.
export type LoadAxis = { total: (entered: number) => number; candidates: (planned: number) => number[] };

const EPSILON = 1e-6;
/// The steepest drop from one set to the next the session's trend is allowed to project, in reps.
const MAX_DROP_PER_SET = 3;
/// How far either side of the planned load the next sets may move, in grid steps.
const LOAD_REACH_STEPS = 8;
/// What a changed load costs per rep it is worth. Changing the load is how a set gets back to its
/// target, so it costs less than missing the target by the same reps: a step that brings the set
/// back to its reps and reserve wins over keeping the load and missing either. Kept above zero so a
/// set only a rep short still keeps its load when a step is worth several reps.
const LOAD_CHANGE_WEIGHT = 0.5;

export function loadAxisFor(entry: LoadEntry, referenceKg: number | null | undefined, grid: LoadGrid): LoadAxis | null {
  if (!grid.availableLoadsKg?.length && grid.stepKg <= 0) return null;
  if (entry === 'external') return { total: load => load, candidates: planned => nearbyLoads(planned, grid, false) };
  if (referenceKg == null || referenceKg <= 0) return null;
  if (entry === 'added') return { total: load => referenceKg + load, candidates: planned => nearbyLoads(planned, grid, true) };
  if (entry === 'assistance') {
    return {
      total: load => referenceKg - load,
      // Assistance can reach zero (no help) but never the whole bodyweight.
      candidates: planned => nearbyLoads(planned, grid, true).filter(load => referenceKg - load > EPSILON)
    };
  }
  return null;
}

/// The entries near the planned one: the weight list's within reach, else whole steps either side.
/// External loads never reach zero; added load and assistance may (bodyweight alone).
function nearbyLoads(planned: number, grid: LoadGrid, zeroAllowed: boolean): number[] {
  const usable = (load: number) => zeroAllowed ? load >= -EPSILON : load > EPSILON;
  const reach = LOAD_REACH_STEPS * Math.max(grid.stepKg, Math.abs(planned) * 0.05, 0.5);
  const loads = grid.availableLoadsKg?.length
    ? [...grid.availableLoadsKg, ...(zeroAllowed ? [0] : [])].filter(load => usable(load) && Math.abs(load - planned) <= reach)
    : Array.from({ length: LOAD_REACH_STEPS * 2 + 1 }, (_, i) => Number((planned + (i - LOAD_REACH_STEPS) * grid.stepKg).toFixed(4)))
      .filter(usable);
  return [planned, ...loads.filter(load => Math.abs(load - planned) > EPSILON)];
}

/// How far one logged set landed from its plan, in reps to failure at its planned load, and its
/// place among the sets of its kind.
export type Deviation = { position: number; reps: number };

/// The session's own fade for one kind of set: the least-squares change in deviation per set. A
/// fade faster than planned is carried forward; a session getting easier is not assumed to keep
/// getting easier, and a single logged set has no trend yet.
export function deviationTrend(deviations: Deviation[]): number {
  if (deviations.length < 2) return 0;
  const meanPosition = deviations.reduce((sum, item) => sum + item.position, 0) / deviations.length;
  const meanReps = deviations.reduce((sum, item) => sum + item.reps, 0) / deviations.length;
  const spread = deviations.reduce((sum, item) => sum + (item.position - meanPosition) ** 2, 0);
  if (spread <= EPSILON) return 0;
  const slope = deviations.reduce((sum, item) => sum + (item.position - meanPosition) * (item.reps - meanReps), 0) / spread;
  return Math.max(-MAX_DROP_PER_SET, Math.min(0, slope));
}

/// The load, reps and reserve closest to a set's target given the reps to failure projected at its
/// planned load. Each option costs its distance from the plan in reps: reps short of the range, a
/// reserve away from the target (the honest one, even past the 5+ the logger can show), and a
/// changed load by half the reps that change is worth. So a set a
/// rep short keeps its load when a step lighter would cost more than that rep, and a small step
/// wins when it lands the set back in range for less. A set that cannot reach the range keeps the
/// target effort with fewer reps rather than being asked past failure.
export function aimedInputs(base: FilledInputs, target: RepPlan, projected: number, axis: LoadAxis | null, trackRir: boolean): FilledInputs | null {
  if (base.reps === null) return null;
  const goal = Math.round(target.goal);
  const planned = base.weightKg;
  const plannedTotal = axis && planned !== null ? axis.total(planned) : null;
  const loads = axis && planned !== null && plannedTotal !== null && plannedTotal > 0 ? axis.candidates(planned) : [planned];

  let best: { load: number | null; reps: number; reserve: number; cost: number } | null = null;
  for (const load of loads) {
    const total = axis && load !== null ? axis.total(load) : null;
    const toFailure = plannedTotal !== null && total !== null && total > 0 && load !== planned
      ? (plannedTotal * (projected + 30)) / total - 30
      : projected;
    const reps = Math.max(1, Math.min(target.high, Math.round(toFailure - target.goal)));
    const honestReserve = Math.max(0, Math.round(toFailure - reps));
    const reserve = Math.min(5, honestReserve);
    const cost = LOAD_CHANGE_WEIGHT * Math.abs(toFailure - projected) + Math.max(0, target.low - reps) + Math.abs(honestReserve - goal);
    if (!best || cost < best.cost - EPSILON) best = { load, reps, reserve, cost };
  }
  if (!best) return null;
  if (best.load === planned && best.reps === base.reps && best.reserve === goal) return base;
  const effort = trackRir ? effortPatch(best.reserve) : { rpe: base.rpe, rir: base.rir };
  return { weightKg: best.load, reps: best.reps, rpe: effort.rpe, rir: effort.rir ?? null };
}
