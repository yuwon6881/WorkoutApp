import type { Unit } from '../types';
import { toDisplay } from './training';

export type ExerciseLoadSettings = {
  loadStepKg: number;
  availableLoadsKg: number[] | null;
  defaultStepKg: number;
  isCustomized: boolean;
  revision: number;
};

// Keep full precision when saving pound-based equipment. Repeated unit switches must
// not change which loads exist on the machine.
export const loadSettingToKg = (value: number, unit: Unit) => unit === 'lb' ? value / 2.2046226218 : value;

export const displayLoadSetting = (value: number, unit: Unit): string => String(Number((toDisplay(value, unit) ?? 0).toFixed(2)));

export function formatAvailableLoads(values: number[], unit: Unit): string {
  return values.map(value => displayLoadSetting(value, unit)).join(', ');
}

export function nextAvailableLoad(value: number | null, weights: readonly number[], direction: 1 | -1): number | null {
  if (!weights.length) return value;
  if (value === null) return weights[0];
  return direction === 1
    ? weights.find(weight => weight > value + 0.00051) ?? value
    : [...weights].reverse().find(weight => weight < value - 0.00051) ?? value;
}
