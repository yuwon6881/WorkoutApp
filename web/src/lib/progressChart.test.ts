import { describe, expect, it } from 'vitest';
import { chartScale, nearestPointIndex, pointPositions, tickLabel } from './progressChart';

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
