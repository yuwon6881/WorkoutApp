/// How many leading items fit on one line `available` pixels wide, keeping room for a trailing
/// "+N more" label whenever some are left out. At least one item is always shown — it is the one
/// allowed to shorten with an ellipsis — so a day never shows only a count.
export function fittingCount(widths: readonly number[], available: number, gap: number, moreWidth: number): number {
  if (widths.length === 0) return 0;
  let used = 0;
  for (let index = 0; index < widths.length; index++) {
    used += (index > 0 ? gap : 0) + widths[index];
    const hidden = widths.length - index - 1;
    const reserve = hidden > 0 ? gap + moreWidth : 0;
    if (used + reserve > available) return Math.max(1, index);
  }
  return widths.length;
}
