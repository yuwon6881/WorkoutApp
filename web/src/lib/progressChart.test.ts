import { describe, expect, it } from 'vitest';
import { chartScale, downsampleChartPoints, nearestPointIndex, pointPositions, tickLabel, type ChartPoint } from './progressChart';

describe('chartScale', () => {
  it('centers a single value on the middle gridline', () => {
    const scale = chartScale([8]);
    expect(scale.ticks).toHaveLength(3);
    expect(scale.ticks[1]).toBe(8);
    expect(scale.min).toBeLessThan(8);
    expect(scale.max).toBeGreaterThan(8);
  });

  it('frames a varied series with round ticks', () => {
    const scale = chartScale([62.5, 70, 77.5]);
    expect(scale.min).toBeLessThanOrEqual(62.5);
    expect(scale.max).toBeGreaterThanOrEqual(77.5);
    for (const tick of scale.ticks) expect(tick % 5).toBe(0);
  });

  it('never drops below zero for non-negative values', () => {
    expect(chartScale([0]).min).toBe(0);
    expect(chartScale([0.5, 1]).min).toBeGreaterThanOrEqual(0);
  });
});

describe('point picking', () => {
  it('centers one point and spreads several across the plot', () => {
    expect(pointPositions(1, 40, 600)).toEqual([320]);
    expect(pointPositions(3, 40, 600)).toEqual([40, 320, 600]);
  });

  it('selects the dot nearest the pointer, including the edge dots', () => {
    const positions = pointPositions(4, 40, 640);
    expect(nearestPointIndex(positions, 0)).toBe(0);
    expect(nearestPointIndex(positions, 250)).toBe(1);
    expect(nearestPointIndex(positions, 460)).toBe(2);
    expect(nearestPointIndex(positions, 700)).toBe(3);
  });
});

describe('tickLabel', () => {
  it('keeps short labels', () => {
    expect(tickLabel(8)).toBe('8');
    expect(tickLabel(62.5)).toBe('62.5');
    expect(tickLabel(12500)).toBe('12.5k');
  });
});

describe('downsampleChartPoints', () => {
  const makePoints = (count: number): ChartPoint[] =>
    Array.from({ length: count }, (_, i) => ({
      key: `k-${i}`,
      date: `Date ${i}`,
      value: 60 + Math.sin(i / 10) * 20 + (i === 500 ? 120 : 0) // noticeable peak at index 500
    }));

  it('leaves points untouched when within the maxPoints limit', () => {
    const points = makePoints(40);
    expect(downsampleChartPoints(points, 80)).toBe(points);
  });

  it('downsamples large histories (e.g. 2000 points) to at most maxPoints', () => {
    const points = makePoints(2000);
    const downsampled = downsampleChartPoints(points, 80);
    expect(downsampled).toHaveLength(80);
    expect(downsampled[0].key).toBe(points[0].key);
    expect(downsampled[downsampled.length - 1].key).toBe(points[points.length - 1].key);
  });

  it('preserves the selected key point even across 2000 points', () => {
    const points = makePoints(2000);
    const targetKey = 'k-1234';
    const downsampled = downsampleChartPoints(points, 80, targetKey);
    expect(downsampled.some(p => p.key === targetKey)).toBe(true);
  });

  it('preserves significant peaks in the series', () => {
    const points = makePoints(2000); // index 500 has value 120
    const downsampled = downsampleChartPoints(points, 80);
    expect(downsampled.some(p => p.key === 'k-500')).toBe(true);
  });
});
