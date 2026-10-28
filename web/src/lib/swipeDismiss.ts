/// Decides whether a swipe gesture should dismiss the element.
/// Dismisses if |dx| >= 64 px OR if horizontal velocity in the drag direction >= 0.5 px/ms.
export function shouldDismiss(dx: number, elapsedMs: number): boolean {
  const absDx = Math.abs(dx);
  if (absDx >= 64) {
    return true;
  }
  if (elapsedMs <= 0) {
    return false;
  }
  const velocity = absDx / elapsedMs;
  return velocity >= 0.5;
}
