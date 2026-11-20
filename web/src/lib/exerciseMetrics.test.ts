import { describe, expect, it } from 'vitest';
import { defaultChartMetric, formatMetricValue, missingEstimateDetail, showEstimate } from './exerciseMetrics';

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

  it('explains the effective rep limit for the displayed set and offers volume when known', () => {
    const point = { date: '2026-11-11', sessionId: 'w-1', sessionName: 'Bench', estimated1RmKg: null,
      loadKg: 55, volumeKg: 1650, reps: 10, rir: '3', partial: false };
    expect(missingEstimateDetail(point, 'kg', {}, true)).toEqual({
      set: '55 kg × 10 reps · 3 reps in reserve',
      reason: 'This set counts as 13 reps for the estimate, above the 12-rep limit.',
      hasVolume: true
    });
    expect(missingEstimateDetail({ ...point, rir: '2' }, 'kg', {}, true).reason).toContain('No set in this workout qualified');
    const hidden = missingEstimateDetail(point, 'kg', {}, false);
    expect(hidden.set).toBe('55 kg × 10 reps');
    expect(hidden.reason).not.toContain('13 reps');
  });

  it('does not assume a missing load, volume, or an exact reserve for 5+', () => {
    const point = { date: '2026-11-11', sessionId: 'w-1', sessionName: 'Bench', estimated1RmKg: null,
      loadKg: null, volumeKg: null, reps: 10, rir: '5+', partial: true };
    const detail = missingEstimateDetail(point, 'kg', {}, true);
    expect(detail.set).toBe('10 reps · 5+ reps in reserve');
    expect(detail.reason).not.toContain('15 reps');
    expect(detail.hasVolume).toBe(false);
  });
});
