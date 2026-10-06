/// Pure geometry for the exercise progress line chart, kept out of the component so the scale
/// and hit-testing rules can be tested without rendering.

export type ChartScale = { min: number; max: number; ticks: number[] };

function niceStep(rough: number) {
  const exponent = Math.floor(Math.log10(rough));
  const base = 10 ** exponent;
  const fraction = rough / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

/// A y scale with round gridline values that frames every known value. A single value (or a
/// flat series) sits on the middle gridline rather than on an edge. Values that are never
/// negative never produce a negative tick.
export function chartScale(values: number[], targetTicks = 3): ChartScale {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const flat = high === low;
  const span = flat ? Math.max(1, Math.abs(high) * 0.2) : high - low;
  const step = niceStep(span / Math.max(1, targetTicks - 1));
  let min = flat ? Math.round(low / step) * step - step : Math.floor(low / step) * step;
  let max = flat ? min + step * 2 : Math.ceil(high / step) * step;
  if (low >= 0 && min < 0) {
    max -= min;
    min = 0;
  }
  if (max === min) max = min + step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return { min, max, ticks };
}

/// X positions for each point across the plot: one point is centered, several span the width.
export function pointPositions(count: number, left: number, right: number) {
  if (count <= 1) return [(left + right) / 2];
  return Array.from({ length: count }, (_, index) => left + (index / (count - 1)) * (right - left));
}

/// The point whose x position is closest to the pointer, so every dot can be picked wherever it
/// sits, including the first and last dots inside the plot padding.
export function nearestPointIndex(positions: number[], x: number) {
  let best = 0;
  for (let index = 1; index < positions.length; index++) {
    if (Math.abs(positions[index] - x) < Math.abs(positions[best] - x)) best = index;
  }
  return best;
}

/// A short gridline label: whole numbers stay whole, and large values are abbreviated.
export function tickLabel(value: number) {
  if (Math.abs(value) >= 10000) return `${Number((value / 1000).toFixed(1))}k`;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}
