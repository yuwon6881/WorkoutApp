/// In the Android WebView an exercise page that has been turned a few times, with dialogs opened
/// and closed in between, can stop answering touch while still being drawn: hit testing at any
/// point of the page returns the scroller behind it, so every tap lands on nothing. Only a style
/// invalidation of the page brings it back, which is what `restorePageReachability` does.

/// True when a point inside the page lands on its own scroller instead of anything in the page.
/// Anything else (a dialog, the rest dock, a floating card) over the point is a different matter
/// and leaves the page alone.
export function pageIsUnreachable(page: HTMLElement, hitAt = document.elementFromPoint.bind(document)): boolean {
  const scroller = page.parentElement;
  if (!scroller) return false;
  const rect = page.getBoundingClientRect();
  const top = Math.max(rect.top, 0);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  if (rect.width < 2 || bottom - top < 2) return false;
  return hitAt(rect.left + rect.width / 2, (top + bottom) / 2) === scroller;
}

/// A style change the page's paint state notices without changing how anything looks.
export function restorePageReachability(page: HTMLElement): void {
  page.style.willChange = 'transform';
  void page.offsetHeight;
  page.style.willChange = '';
}

/// Repairs the page when it is unreachable; returns whether it did.
export function healPageReachability(page: HTMLElement | null): boolean {
  if (!page || !pageIsUnreachable(page)) return false;
  restorePageReachability(page);
  page.dataset.reachabilityRepairs = String(Number(page.dataset.reachabilityRepairs ?? 0) + 1);
  return true;
}
