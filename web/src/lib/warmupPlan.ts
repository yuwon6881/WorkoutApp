import type { Unit } from '../types';
import type { LoadEntry } from './resistanceVariant';
import type { LoadGrid } from './liveAdjustmentAim';

/// One warm-up set: the load as the row enters it and its reps.
export type WarmupStep = { weightKg: number; reps: number };

export type WarmupContext = {
  /// The first working set's load, as entered (total, per side, or added load).
  workingKg: number;
  /// The catalog's equipment ("Barbell", "Dumbbell", "Machine", ...) and primary muscle.
  equipment: string;
  muscle: string;
  /// Whether a dumbbell entry is one hand's weight rather than the total.
  perSide: boolean;
  entry: LoadEntry;
  /// The session's frozen bodyweight, when known.
  bodyweightKg: number | null;
  unit: Unit;
  grid: LoadGrid;
};

type Implement = 'barbell' | 'machine' | 'dumbbell' | 'light';

const LB = 0.45359237;
const EPSILON = 1e-4;

/// Muscles worked through a short range or by small movements need less ramping than big lifts.
const SMALL_MUSCLES = ['biceps and forearms', 'triceps', 'traps, calves, and hips', 'traps', 'adductors and neck', 'core'];

function implementOf(equipment: string): Implement {
  const kind = equipment.trim().toLowerCase();
  if (['barbell', 'ez-bar', 'trap bar'].includes(kind)) return 'barbell';
  if (['machine', 'smith machine', 'plate', 'plate-loaded machine'].includes(kind)) return 'machine';
  if (['dumbbell', 'kettlebell'].includes(kind)) return 'dumbbell';
  return 'light';
}

/// The empty bar a barbell ramp starts from, in kilograms.
function emptyBarKg(equipment: string, unit: Unit): number | null {
  const kind = equipment.trim().toLowerCase();
  if (kind === 'barbell') return unit === 'lb' ? 45 * LB : 20;
  if (kind === 'ez-bar') return unit === 'lb' ? 25 * LB : 10;
  if (kind === 'trap bar') return unit === 'lb' ? 55 * LB : 25;
  return null;
}

/// How heavy the working load is for this lifter: relative to bodyweight when it is known (a total
/// for dumbbells entered per hand), else against fixed loads a typical lifter would find heavy.
function heaviness(context: WarmupContext): number {
  const total = context.perSide ? context.workingKg * 2 : context.workingKg;
  if (context.bodyweightKg && context.bodyweightKg > 0) return total / context.bodyweightKg;
  return total / 80;
}

/**
 * How many warm-up sets the working load calls for. Heavier loads and free weights need more ramp
 * (more joints and stabilisers to prepare, and a bigger jump from nothing); machines guide the path
 * and need less; isolation work on small muscles needs one fewer; very light loads need just one.
 */
export function recommendedWarmupCount(context: WarmupContext): number {
  if (context.entry === 'none' || context.entry === 'assistance' || context.workingKg <= 0) return 0;
  const ratio = heaviness(context);
  const implement = context.entry === 'added' ? 'dumbbell' : implementOf(context.equipment);
  let count = implement === 'barbell' ? (ratio >= 1.25 ? 4 : ratio >= 0.75 ? 3 : 2)
    : implement === 'machine' ? (ratio >= 1 ? 2 : 1)
      : implement === 'dumbbell' ? (ratio >= 0.5 ? 2 : 1)
        : 1;
  if (SMALL_MUSCLES.includes(context.muscle.trim().toLowerCase())) count -= 1;
  return Math.max(1, count);
}

/// The fraction of the working load and the reps for each warm-up, by how many there are: reps
/// fall as the load climbs, so the warm-ups prime the lift without tiring the lifter.
const SCHEDULES: Record<number, Array<[number, number]>> = {
  1: [[0.6, 8]],
  2: [[0.5, 8], [0.75, 4]],
  3: [[0.4, 8], [0.6, 5], [0.8, 3]],
  4: [[0.3, 10], [0.5, 5], [0.7, 3], [0.85, 1]],
  5: [[0.3, 10], [0.45, 6], [0.6, 4], [0.75, 2], [0.88, 1]]
};

/// The heaviest load on the grid at or below a value: a listed weight, else a whole step.
function snapDown(value: number, grid: LoadGrid, floor: number): number | null {
  const listed = grid.availableLoadsKg?.filter(load => load <= value + EPSILON && load >= floor - EPSILON);
  if (listed?.length) return Math.max(...listed);
  if (grid.availableLoadsKg?.length) return null;
  if (grid.stepKg <= 0) return Number(value.toFixed(2));
  const snapped = Math.floor((value + EPSILON) / grid.stepKg) * grid.stepKg;
  return snapped >= floor - EPSILON ? Number(snapped.toFixed(4)) : null;
}

/**
 * The warm-up sets for a working load, lightest first. A barbell ramp of two or more opens with the
 * empty bar unless the first step is already twice its weight,
 * every load snaps down to one the lifter can make and stays below the working load, and steps
 * that round onto the same load collapse, so a light working load can return fewer sets than
 * asked for. Added-load movements (weighted pull-ups and dips) start from bodyweight alone.
 */
export function warmupSteps(context: WarmupContext, count: number): WarmupStep[] {
  if (count <= 0 || context.workingKg <= 0) return [];
  const schedule = SCHEDULES[Math.min(count, 5)];
  const bar = context.entry === 'external' ? emptyBarKg(context.equipment, context.unit) : null;
  const floor = context.entry === 'added' ? 0 : bar ?? (context.grid.stepKg > 0 ? context.grid.stepKg : EPSILON);
  const steps: WarmupStep[] = [];
  schedule.forEach(([fraction, reps], index) => {
    const raw = context.workingKg * fraction;
    // A light first step of a longer barbell ramp is just the empty bar: a few kilos over it add
    // nothing. A lone warm-up does the priming alone, so it stays at its share of the working load.
    const opensWithBar = index === 0 && bar !== null && schedule.length > 1 && raw < bar * 2;
    const target = opensWithBar ? bar : index === 0 && context.entry === 'added' ? 0 : raw;
    const load = target <= floor + EPSILON ? floor : snapDown(target, context.grid, floor);
    if (load === null || load >= context.workingKg - EPSILON) return;
    const previous = steps.at(-1);
    if (previous && load <= previous.weightKg + EPSILON) return;
    steps.push({ weightKg: load, reps });
  });
  return steps;
}
