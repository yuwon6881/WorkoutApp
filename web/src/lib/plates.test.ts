import { describe, expect, it } from 'vitest';
import { platesFor } from './plates';

describe('plate loading', () => {
  it('loads each side heaviest first', () => {
    expect(platesFor(100, 20, 'kg')).toEqual({ perSide: [25, 15], loaded: 100, remainder: 0 });
    expect(platesFor(62.5, 20, 'kg')).toEqual({ perSide: [20, 1.25], loaded: 62.5, remainder: 0 });
    expect(platesFor(225, 45, 'lb')).toEqual({ perSide: [45, 45], loaded: 225, remainder: 0 });
  });

  it('reports what standard plates cannot make instead of rounding it away', () => {
    expect(platesFor(61, 20, 'kg')).toEqual({ perSide: [20], loaded: 60, remainder: 1 });
  });

  it('has nothing to load below the bar, and an empty bar at its own weight', () => {
    expect(platesFor(15, 20, 'kg')).toBeNull();
    expect(platesFor(20, 20, 'kg')).toEqual({ perSide: [], loaded: 20, remainder: 0 });
  });
});
