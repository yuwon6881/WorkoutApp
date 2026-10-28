export const SWIPE_SLOP_PX = 6;

/// Classifies an ongoing pointer gesture into undecided, horizontal or vertical.
/// Remains undecided until travel reaches the slop threshold. Only treated as vertical
/// when vertical movement strictly dominates horizontal movement by a 1.5 ratio, allowing
/// slightly diagonal swipes to still be recognized horizontally.
export function classifyGesture(dx: number, dy: number): 'undecided' | 'horizontal' | 'vertical' {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.max(absX, absY) < SWIPE_SLOP_PX) {
    return 'undecided';
  }
  if (absY > absX * 1.5) {
    return 'vertical';
  }
  return 'horizontal';
}

/// Decides whether a swipeable row drawer should settle open or closed on pointer release.
/// A leftward fling (velocity <= -0.4 px/ms) opens; a rightward fling (velocity >= 0.4 px/ms) closes.
/// Otherwise open when offset has dragged past 30% of actionsWidth; when already open, close when dragged
/// back more than 30%.
export function settleOpen(params: {
  wasOpen: boolean;
  offset: number;
  velocityPxPerMs: number;
  actionsWidth: number;
}): boolean {
  const { wasOpen, offset, velocityPxPerMs, actionsWidth } = params;
  if (velocityPxPerMs <= -0.4) {
    return true;
  }
  if (velocityPxPerMs >= 0.4) {
    return false;
  }
  if (wasOpen) {
    return offset <= -actionsWidth * 0.7;
  }
  return offset <= -actionsWidth * 0.3;
}
