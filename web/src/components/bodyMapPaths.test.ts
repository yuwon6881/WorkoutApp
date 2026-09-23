import { describe, expect, it } from 'vitest';
import { BODY_MAP_VIEW_BOX, FOREARM_INNER, FOREARM_OUTER, FRONT_PARTS, FRONT_REGIONS, HAND, mirror } from './bodyMapFrontPaths';
import { BACK_PARTS, BACK_REGIONS } from './bodyMapBackPaths';

/// Mirrors `MuscleRegions.All` in api/Services/MuscleAttribution.cs. A region key that is not on
/// this list is a shape nothing can ever fill, and a name the server credits with no shape here is
/// coverage the map silently drops.
const CANONICAL = [
  'Neck', 'Traps', 'Shoulders', 'Chest', 'Back', 'Biceps', 'Triceps',
  'Forearms', 'Core', 'Glutes', 'Quads', 'Hamstrings', 'Adductors', 'Calves'
];

const [, , viewWidth, viewHeight] = BODY_MAP_VIEW_BOX.split(' ').map(Number);

function coordinates(path: string): { x: number; y: number }[] {
  return [...path.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)]
    .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
}

const subpaths = (path: string) => path.split('M').slice(1).map(part => `M${part}`.trim());
const allRegions = [...Object.entries(FRONT_REGIONS), ...Object.entries(BACK_REGIONS)];

describe('body map plates', () => {
  it('only names muscles the server credits', () => {
    for (const [key] of allRegions) expect(CANONICAL, `${key} is not a canonical muscle`).toContain(key);
  });

  it('covers every canonical muscle across the two views', () => {
    const drawn = new Set(allRegions.map(([key]) => key));
    expect(CANONICAL.filter(muscle => !drawn.has(muscle))).toEqual([]);
  });

  it('keeps every coordinate inside the view box', () => {
    for (const path of [FRONT_PARTS, BACK_PARTS, ...allRegions.map(([, path]) => path)]) {
      for (const { x, y } of coordinates(path)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(viewWidth);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(viewHeight);
      }
    }
  });

  it('closes every plate', () => {
    for (const [key, path] of allRegions) {
      expect(subpaths(path).length, `${key} has no plate`).toBeGreaterThan(0);
      for (const plate of subpaths(path)) expect(plate.endsWith('Z'), `${key} leaves a plate open`).toBe(true);
    }
  });

  /// Plates are written for the left side and mirrored, so each muscle is a left/right pair and the
  /// two halves are exact reflections of each other.
  it('draws every muscle as mirrored left and right plates', () => {
    for (const [key, path] of allRegions) {
      const plates = subpaths(path);
      expect(plates.length % 2, `${key} is not a left/right pair`).toBe(0);
      for (let index = 0; index < plates.length; index += 2) {
        expect(plates[index + 1], `${key} halves differ`).toBe(mirror(plates[index]));
      }
    }
  });

  it('keeps the left side left of the centre line', () => {
    for (const [key, path] of allRegions) {
      for (let index = 0; index < subpaths(path).length; index += 2) {
        for (const { x } of coordinates(subpaths(path)[index])) expect(x, `${key} crosses the centre`).toBeLessThanOrEqual(100);
      }
    }
  });

  /// The two views share one body, so the same arm hangs in the same place from either side.
  it('hangs the same arm in both views', () => {
    expect(FRONT_REGIONS.Forearms).toBe(BACK_REGIONS.Forearms);
    expect(FRONT_REGIONS.Forearms).toContain(FOREARM_OUTER);
    expect(FRONT_REGIONS.Forearms).toContain(FOREARM_INNER);
    expect(FRONT_PARTS).toContain(HAND);
    expect(BACK_PARTS).toContain(HAND);
  });

  it('mirrors a left-side path about the centre line', () => {
    expect(mirror('M80 202 C84 210 86 224 86 244')).toBe('M120 202 C116 210 114 224 114 244');
    expect(mirror('L100 140')).toBe('L100 140');
  });
});
