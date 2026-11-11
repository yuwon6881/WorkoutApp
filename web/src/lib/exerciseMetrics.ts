import type { ExerciseInsight, Unit } from '../types';
import { showVolume, toDisplay } from './training';
import { showExerciseWeight, weightUnit, type WithWeightBasis } from './weightBasis';

export type ChartMetric = 'estimated1rm' | 'load' | 'volume' | 'reps';
type MetricPoint = ExerciseInsight['points'][number];

const chartMetrics: ChartMetric[] = ['estimated1rm', 'load', 'volume', 'reps'];

export function metricValue(point: MetricPoint, metric: ChartMetric): number | null {
  if (metric === 'estimated1rm') return point.estimated1RmKg;
  if (metric === 'load') return point.loadKg;
  if (metric === 'volume') return point.volumeKg;
  return point.reps;
}

/// The first metric any session has a value for, so the chart never opens on an empty one.
export function defaultChartMetric(points: MetricPoint[]): ChartMetric {
  if (!points.length) return 'estimated1rm';
  return chartMetrics.find(candidate => points.some(point => metricValue(point, candidate) != null)) ?? 'estimated1rm';
}

export function chartMetricLabel(metric: ChartMetric): string {
  if (metric === 'estimated1rm') return 'Estimated 1RM';
  if (metric === 'load') return 'Heaviest load';
  if (metric === 'volume') return 'Session volume';
  return 'Reps';
}

/// An estimate is a calculation, not a plate on the bar: one decimal is as exact as it honestly is.
export function showEstimate(kg: number | null | undefined, unit: Unit, exercise: WithWeightBasis): string {
  const value = toDisplay(kg ?? null, unit);
  return value === null ? '—' : `${Number(value.toFixed(1))} ${weightUnit(unit, exercise)}`;
}

/// How one metric's value reads in the chart, in the unit and weight basis the exercise is logged in.
/// A logged load keeps the exact value that was entered.
export function formatMetricValue(value: number | null, metric: ChartMetric, unit: Unit, exercise: WithWeightBasis): string {
  if (value == null) return 'Unavailable';
  if (metric === 'reps') return `${value} reps`;
  if (metric === 'volume') return showVolume(value, unit);
  if (metric === 'estimated1rm') return showEstimate(value, unit, exercise);
  return showExerciseWeight(value, unit, exercise);
}
