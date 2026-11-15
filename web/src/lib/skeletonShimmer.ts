/// Every loading block sweeps a highlight across itself, and a CSS animation starts when its element
/// does, so each placeholder swapped for its twin during a load would restart its sweep and the page
/// would flash in pulses. All sweeps are instead pinned to the page's timeline origin, so a new
/// placeholder joins the sweep already under way.
const SHIMMER = 'skeleton-shimmer';

function alignShimmers(): void {
  for (const animation of document.getAnimations()) {
    if (animation instanceof CSSAnimation && animation.animationName === SHIMMER && animation.startTime !== 0) {
      animation.startTime = 0;
    }
  }
}

export function syncSkeletonShimmer(): void {
  if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') return;
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (document.querySelector('.skeleton')) alignShimmers();
    });
  };
  new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
  queue();
}
