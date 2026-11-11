import { describe, expect, it } from 'vitest';
import { defaultChartMetric, formatMetricValue, showEstimate } from './exerciseMetrics';

describe('exercise metric formatting', () => {
  it('keeps the half kilogram of a logged load at and above 100 kg', () => {
    expect(formatMetricValue(102.5, 'load', 'kg', {})).toBe('102.5 kg');
    expect(formatMetricValue(100, 'load', 'kg', {})).toBe('100 kg');
  });

  it('names per-side loads and estimates per side, as the history tab does', () => {
    expect(formatMetricValue(22.5, 'load', 'kg', { weightBasis: 'per_side' })).toBe('22.5 kg/side');
    expect(showEstimate(30.26, 'kg', { weightBasis: 'per_side' })).toBe('30.3 kg/side');
  });

  it('rounds an estimate to one decimal and leaves an unknown one as a dash', () => {
    expect(showEstimate(123.4567, 'kg', {})).toBe('123.5 kg');
    expect(showEstimate(null, 'kg', {})).toBe('—');
  });

  it('shows volume as a whole total and reps as a count', () => {
    expect(formatMetricValue(1234.6, 'volume', 'kg', {})).toBe(`${(1235).toLocaleString()} kg`);
    expect(formatMetricValue(8, 'reps', 'kg', {})).toBe('8 reps');
    expect(formatMetricValue(null, 'load', 'kg', {})).toBe('Unavailable');
  });

  it('opens on the first metric that has a value', () => {
    const point = { date: '2026-10-06', sessionId: 'w-1', sessionName: 'Full Body', estimated1RmKg: null, loadKg: null, volumeKg: null, reps: 4, partial: true };
    expect(defaultChartMetric([point])).toBe('reps');
    expect(defaultChartMetric([])).toBe('estimated1rm');
  });
});
