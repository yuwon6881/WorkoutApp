import type { Unit, WeightBasis } from '../types';
import { showWeight } from './training';

export type WithWeightBasis = { weightBasis?: WeightBasis };

export function weightUnit(unit: string, exercise: WithWeightBasis): string {
  return exercise.weightBasis === 'per_side' ? `${unit}/side` : unit;
}

export function showExerciseWeight(kg: number | null | undefined, unit: Unit, exercise: WithWeightBasis): string {
  return showWeight(kg ?? null, unit).replace(unit, weightUnit(unit, exercise));
}

export function weightBasisDescription(exercise: WithWeightBasis): string {
  return exercise.weightBasis === 'per_side'
    ? 'Weight per side: enter one dumbbell or one side, without adding left and right.'
    : 'Total weight: enter the full implement, selected stack, or total machine plates.';
}
