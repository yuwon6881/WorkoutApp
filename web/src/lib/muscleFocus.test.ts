import { describe, expect, it } from 'vitest';
import { BACK_REGIONS, BODY_MAP_VIEW_BOX, FRONT_REGIONS } from '../components/bodyMapPaths';
import { blendViewBox, focusViewBox, MUSCLE_SIDE, parseViewBox, type ViewBox } from './muscleFocus';

const frame = parseViewBox(BODY_MAP_VIEW_BOX);
const regionsFor = (muscle: string) => (MUSCLE_SIDE[muscle] === 'front' ? FRONT_REGIONS : BACK_REGIONS);

function contains(box: ViewBox, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

describe('muscle focus crop', () => {
  it('gives every canonical muscle a side that actually draws it', () => {
    for (const [muscle, side] of Object.entries(MUSCLE_SIDE)) {
      const regions = side === 'front' ? FRONT_REGIONS : BACK_REGIONS;
      expect(regions[muscle], `${muscle} has no ${side} plate`).toBeDefined();
    }
  });

  it('zooms well inside the whole figure and stays within it', () => {
    for (const muscle of Object.keys(MUSCLE_SIDE)) {
      const box = focusViewBox(muscle, regionsFor(muscle)[muscle], 4 / 3, frame);
      expect(box.width * box.height, muscle).toBeLessThan(frame.width * frame.height / 2);
      expect(box.x).toBeGreaterThanOrEqual(frame.x);
      expect(box.y).toBeGreaterThanOrEqual(frame.y);
      expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
      // A crop clamped to the figure keeps its height; the SVG letterboxes the difference.
      if (box.width < frame.width) expect(box.width / box.height, muscle).toBeCloseTo(4 / 3, 1);
    }
  });

  it('frames one limb rather than both arms', () => {
    const box = focusViewBox('Biceps', FRONT_REGIONS.Biceps, 4 / 3, frame);
    expect(contains(box, 56, 135)).toBe(true);
    expect(contains(box, 144, 135)).toBe(false);
  });

  it('frames both sides of a muscle that meets at the midline', () => {
    const box = focusViewBox('Chest', FRONT_REGIONS.Chest, 4 / 3, frame);
    expect(contains(box, 72, 100)).toBe(true);
    expect(contains(box, 128, 100)).toBe(true);
  });

  it('falls back to the whole figure for a missing plate', () => {
    expect(focusViewBox('Unknown', '', 4 / 3, frame)).toEqual(frame);
  });

  it('blends linearly between crops', () => {
    const from = { x: 0, y: 0, width: 100, height: 100 };
    const to = { x: 50, y: 20, width: 60, height: 40 };
    expect(blendViewBox(from, to, 0)).toEqual(from);
    expect(blendViewBox(from, to, 1)).toEqual(to);
    expect(blendViewBox(from, to, 0.5)).toEqual({ x: 25, y: 10, width: 80, height: 70 });
  });
});
