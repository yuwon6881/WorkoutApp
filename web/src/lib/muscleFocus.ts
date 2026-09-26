/**
 * Crops the body map onto one muscle. The crop is derived from the plate geometry itself, so a
 * reshaped plate can never leave its zoomed view pointing at the wrong place.
 */

export type BodySide = 'front' | 'back';
export type ViewBox = { x: number; y: number; width: number; height: number };

/// Where a muscle reads best when only one side can be shown.
export const MUSCLE_SIDE: Record<string, BodySide> = {
  Neck: 'front', Traps: 'back', Shoulders: 'front', Chest: 'front', Back: 'back',
  Biceps: 'front', Triceps: 'back', Forearms: 'front', Core: 'front', Glutes: 'back',
  Quads: 'front', Hamstrings: 'back', Adductors: 'front', Calves: 'back'
};

/// Limb muscles are drawn on both sides of the body, far apart. Framing both would zoom out to the
/// whole torso, so these frame the figure's left limb alone.
const ONE_LIMB = new Set(['Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Quads', 'Hamstrings', 'Calves']);

const CENTRE_X = 100;

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function boundsOf(path: string): Bounds | null {
  let bounds: Bounds | null = null;
  // Plates use absolute commands with plain x/y pairs; control points only widen the box slightly.
  for (const [, x, y] of path.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
    const px = Number(x);
    const py = Number(y);
    bounds = bounds
      ? { minX: Math.min(bounds.minX, px), minY: Math.min(bounds.minY, py), maxX: Math.max(bounds.maxX, px), maxY: Math.max(bounds.maxY, py) }
      : { minX: px, minY: py, maxX: px, maxY: py };
  }
  return bounds;
}

function merge(left: Bounds | null, right: Bounds | null): Bounds | null {
  if (!left) return right;
  if (!right) return left;
  return {
    minX: Math.min(left.minX, right.minX), minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX), maxY: Math.max(left.maxY, right.maxY)
  };
}

function regionBounds(muscle: string, path: string): Bounds | null {
  const subpaths = path.split('M').slice(1).map(part => `M${part}`);
  const limb = ONE_LIMB.has(muscle);
  let bounds: Bounds | null = null;
  for (const subpath of subpaths) {
    const part = boundsOf(subpath);
    if (!part) continue;
    if (limb && part.minX >= CENTRE_X) continue;
    bounds = merge(bounds, part);
  }
  return bounds;
}

/**
 * A view box around the muscle with breathing room, widened to `aspect` (width / height) and never
 * smaller than `minSize` on its short edge, so small plates are shown with enough surrounding body
 * to be recognisable.
 */
export function focusViewBox(muscle: string, path: string, aspect: number, frame: ViewBox,
  { padding = 0.35, minSize = 64 }: { padding?: number; minSize?: number } = {}): ViewBox {
  const bounds = regionBounds(muscle, path);
  if (!bounds) return frame;
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  let width = (bounds.maxX - bounds.minX) * (1 + padding * 2);
  let height = (bounds.maxY - bounds.minY) * (1 + padding * 2);
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  if (Math.min(width, height) < minSize) {
    const scale = minSize / Math.min(width, height);
    width *= scale;
    height *= scale;
  }
  width = Math.min(width, frame.width);
  height = Math.min(height, frame.height);
  const x = Math.min(Math.max(centreX - width / 2, frame.x), frame.x + frame.width - width);
  const y = Math.min(Math.max(centreY - height / 2, frame.y), frame.y + frame.height - height);
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

const round = (value: number) => Math.round(value * 10) / 10;

export function parseViewBox(value: string): ViewBox {
  const [x, y, width, height] = value.split(/\s+/).map(Number);
  return { x, y, width, height };
}

export function formatViewBox(box: ViewBox): string {
  return `${box.x} ${box.y} ${box.width} ${box.height}`;
}

/// Linear blend between two crops, used to glide the zoom from one muscle to the next.
export function blendViewBox(from: ViewBox, to: ViewBox, progress: number): ViewBox {
  const at = (a: number, b: number) => a + (b - a) * progress;
  return { x: at(from.x, to.x), y: at(from.y, to.y), width: at(from.width, to.width), height: at(from.height, to.height) };
}
