import type { Unit } from '../types';

export const BAR_OPTIONS: Record<Unit, number[]> = { kg: [20, 15, 10], lb: [45, 35, 25] };
export const PLATE_SIZES: Record<Unit, number[]> = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] };

export type PlateLoad = { perSide: number[]; loaded: number; remainder: number };

// Plates for one side of the bar, heaviest first, for a total in the display unit. What the
// standard plates cannot make exactly is reported as a remainder rather than rounded away.
export function platesFor(total: number, bar: number, unit: Unit): PlateLoad | null {
  if (!Number.isFinite(total) || total < bar) return null;
  let side = (total - bar) / 2;
  const perSide: number[] = [];
  for (const plate of PLATE_SIZES[unit]) {
    while (side + 1e-9 >= plate) {
      perSide.push(plate);
      side -= plate;
    }
  }
  const remainder = Math.round(side * 2 * 1000) / 1000;
  return { perSide, loaded: bar + perSide.reduce((sum, plate) => sum + plate, 0) * 2, remainder };
}
