import type { Exercise, Unit } from '../types';
import { toDisplay } from './training';
import { equipmentGroupInfo } from './equipmentGroups';

export type LoadSource = 'exercise' | 'equipment' | 'app';

export type InheritedLoad = {
  stepKg: number;
  availableLoadsKg: number[] | null;
  source: LoadSource;
  equipmentGroup: string | null;
};

/// loadStepKg and availableLoadsKg are what progression uses now; the own fields are the exercise's
/// own rule, and none of them set means it inherits.
export type ExerciseLoadSettings = {
  loadStepKg: number;
  availableLoadsKg: number[] | null;
  defaultStepKg: number;
  isCustomized: boolean;
  revision: number;
  ownStepKg?: number | null;
  ownAvailableLoadsKg?: number[] | null;
  source?: LoadSource;
  inherited?: InheritedLoad | null;
};

/// One stored rule: a step or a weight list. All null restores the inherited rule.
export type LoadRule = { loadStepKg: number | null; availableLoadsKg: number[] | null };

export type EquipmentLoad = {
  group: string; appDefaultStepKg: number; ownStepKg: number | null; ownAvailableLoadsKg: number[] | null;
  stepKg: number; availableLoadsKg: number[] | null; source: LoadSource; revision: number; exerciseCount: number;
};
export type LoadSettingsOverview = { equipment: EquipmentLoad[] };

// Keep full precision when saving pound-based equipment. Repeated unit switches must
// not change which loads exist on the machine.
export const loadSettingToKg = (value: number, unit: Unit) => unit === 'lb' ? value / 2.2046226218 : value;

export const displayLoadSetting = (value: number, unit: Unit): string => String(Number((toDisplay(value, unit) ?? 0).toFixed(2)));

export function formatAvailableLoads(values: number[], unit: Unit): string {
  return values.map(value => displayLoadSetting(value, unit)).join(', ');
}

/// "2.5 kg steps" or "5, 10, 15 kg": the rule in the words a lifter reads on a gym card.
export function describeLoad(stepKg: number | null, loadsKg: number[] | null, unit: Unit): string {
  if (loadsKg?.length) return loadsKg.length > 4
    ? `${loadsKg.length} weights · ${displayLoadSetting(loadsKg[0], unit)}–${displayLoadSetting(loadsKg[loadsKg.length - 1], unit)} ${unit}`
    : `${formatAvailableLoads(loadsKg, unit)} ${unit}`;
  if (stepKg === null) return 'Not set';
  return stepKg === 0 ? 'Fixed load, progress by reps' : `${displayLoadSetting(stepKg, unit)} ${unit} steps`;
}

/// Where the rule in use comes from, so "Default" never hides which default.
export function describeSource(source: LoadSource | undefined, group: string | null | undefined): string {
  if (source === 'exercise') return "This exercise's setting";
  if (source === 'equipment') return `${group ? equipmentGroupInfo(group).label : 'Equipment'} default`;
  return 'App default';
}

/// Fills a list from a starting weight, a step and a count, in the unit the lifter reads.
export function generateLoads(start: number, step: number, count: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(step) || step <= 0 || !Number.isInteger(count) || count < 1) return [];
  return Array.from({ length: Math.min(count, 200) }, (_, index) => Number((start + step * index).toFixed(3)));
}

export function nextAvailableLoad(value: number | null, weights: readonly number[], direction: 1 | -1): number | null {
  if (!weights.length) return value;
  if (value === null) return weights[0];
  return direction === 1
    ? weights.find(weight => weight > value + 0.00051) ?? value
    : [...weights].reverse().find(weight => weight < value - 0.00051) ?? value;
}

/// Only an exercise that moves an external or added load has weights to configure.
export const loadAdjustable = (exercise: Pick<Exercise, 'loadModel'>): boolean =>
  exercise.loadModel === undefined || exercise.loadModel === 'external' || exercise.loadModel === 'full_bodyweight';
