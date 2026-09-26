import { useEffect, useRef } from 'react';

/// Loads the next page as the list's "Load more" control nears the screen, so scrolling a long
/// history never stops at a button. The button stays as the visible, keyboard-reachable fallback,
/// and nothing loads while a page is already on its way or the list is complete.
export function useLoadMoreOnScroll(canLoad: boolean, loadMore: () => void) {
  const ref = useRef<HTMLButtonElement>(null);
  const latest = useRef(loadMore);
  latest.current = loadMore;

  useEffect(() => {
    const target = ref.current;
    if (!canLoad || !target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) latest.current();
    }, { rootMargin: '0px 0px 320px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoad]);

  return ref;
}
