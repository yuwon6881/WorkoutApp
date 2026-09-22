import { describe, expect, it } from 'vitest';
import { BODY_MAP_VIEW_BOX, FRONT_REGIONS, FRONT_SEAMS, FRONT_SILHOUETTE, mirror } from './bodyMapFrontPaths';
import { BACK_REGIONS, BACK_SEAMS, BACK_SILHOUETTE } from './bodyMapBackPaths';

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

describe('body map paths', () => {
  it('only names muscles the server credits', () => {
    for (const key of [...Object.keys(FRONT_REGIONS), ...Object.keys(BACK_REGIONS)]) {
      expect(CANONICAL, `${key} is not a canonical muscle`).toContain(key);
    }
  });

  it('covers every canonical muscle across the two views', () => {
    const drawn = new Set([...Object.keys(FRONT_REGIONS), ...Object.keys(BACK_REGIONS)]);
    expect([...CANONICAL].filter(muscle => !drawn.has(muscle))).toEqual([]);
  });

  it('keeps every coordinate inside the view box', () => {
    const paths = [
      FRONT_SILHOUETTE, BACK_SILHOUETTE,
      ...Object.values(FRONT_REGIONS), ...Object.values(BACK_REGIONS)
    ];
    for (const path of paths) {
      for (const { x, y } of coordinates(path)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(viewWidth);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(viewHeight);
      }
    }
  });

  it('starts every subpath with a move and closes it', () => {
    for (const [key, path] of [...Object.entries(FRONT_REGIONS), ...Object.entries(BACK_REGIONS)]) {
      const subpaths = path.split('M').slice(1);
      expect(subpaths.length, `${key} has no subpath`).toBeGreaterThan(0);
      for (const subpath of subpaths) {
        expect(subpath.trim().endsWith('Z'), `${key} leaves a subpath open`).toBe(true);
      }
    }
  });

  /// The defect this file exists to prevent: two regions that meet, each carrying its own idea of
  /// where. A region may walk a seam in either direction, so what has to match is the set of points
  /// on it, not the text — a region that re-typed the edge slightly differently fails here.
  function sharesSeam(regions: Record<string, string>, seam: string, names: string[]) {
    for (const name of names) {
      const path = regions[name];
      expect(path, `${name} has no path`).toBeTruthy();
      for (const { x, y } of coordinates(seam)) {
        expect(path, `${name} does not meet the seam at ${x} ${y}`).toContain(`${x} ${y}`);
      }
    }
  }

  it.each([
    ['trapBottom', FRONT_SEAMS.trapBottom, ['Traps', 'Chest']],
    ['deltChest', FRONT_SEAMS.deltChest, ['Chest', 'Shoulders']],
    ['deltArm', FRONT_SEAMS.deltArm, ['Shoulders', 'Biceps']],
    ['armMedial', FRONT_SEAMS.armMedial, ['Biceps']],
    ['chestBottom', FRONT_SEAMS.chestBottom, ['Chest', 'Core']],
    ['quadAdductor', FRONT_SEAMS.quadAdductor, ['Adductors', 'Quads']],
    ['kneeLeft', FRONT_SEAMS.kneeLeft, ['Quads', 'Calves']]
  ])('front %s joins its regions at the same points', (_name, seam, regions) => {
    sharesSeam(FRONT_REGIONS, seam as string, regions as string[]);
  });

  it.each([
    ['trapLat', BACK_SEAMS.trapLat, ['Traps', 'Back']],
    ['deltArm', BACK_SEAMS.deltArm, ['Shoulders', 'Triceps']],
    ['deltBack', BACK_SEAMS.deltBack, ['Shoulders']],
    ['armMedial', BACK_SEAMS.armMedial, ['Triceps']],
    ['latGlute', BACK_SEAMS.latGlute, ['Back', 'Glutes']],
    ['gluteHamstring', BACK_SEAMS.gluteHamstring, ['Glutes', 'Hamstrings']],
    ['kneeLeft', BACK_SEAMS.kneeLeft, ['Calves']]
  ])('back %s joins its regions at the same points', (_name, seam, regions) => {
    sharesSeam(BACK_REGIONS, seam as string, regions as string[]);
  });

  it('mirrors a left-side path about the centre line', () => {
    expect(mirror('M80 202 C84 210 86 224 86 244')).toBe('M120 202 C116 210 114 224 114 244');
    expect(mirror('L100 140')).toBe('L100 140');
  });

  it('gives every paired region two subpaths, one per side', () => {
    const paired = ['Chest', 'Shoulders', 'Biceps', 'Forearms', 'Core', 'Quads', 'Adductors', 'Calves'];
    for (const key of paired) {
      expect((FRONT_REGIONS[key].match(/M/g) ?? []).length, `${key} is not a left/right pair`).toBe(2);
    }
  });
});
