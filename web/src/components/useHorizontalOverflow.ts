import { useEffect, useState, type RefObject } from 'react';

export interface HorizontalOverflow {
  /** Content is hidden past the leading edge (the row has been scrolled). */
  start: boolean;
  /** Content is hidden past the trailing edge. */
  end: boolean;
}

const NONE: HorizontalOverflow = { start: false, end: false };

/** Sub-pixel scroll positions on zoomed or high-density screens never land exactly on an edge. */
const EDGE_TOLERANCE_PX = 2;

export function readHorizontalOverflow(element: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>): HorizontalOverflow {
  const hidden = element.scrollWidth - element.clientWidth;
  if (hidden <= EDGE_TOLERANCE_PX) return NONE;
  return {
    start: element.scrollLeft > EDGE_TOLERANCE_PX,
    end: element.scrollLeft < hidden - EDGE_TOLERANCE_PX
  };
}

/// Which edges of a horizontal scroller hide content, kept current through scrolling, resizing and
/// content changes, so a row with a hidden scrollbar can still show that more lies off-screen.
/// `selector` finds the scroller inside `ref` when the scroller itself cannot take a ref.
export function useHorizontalOverflow(ref: RefObject<HTMLElement | null>, selector?: string): HorizontalOverflow {
  const [overflow, setOverflow] = useState<HorizontalOverflow>(NONE);

  useEffect(() => {
    const container = ref.current;
    const element = selector ? container?.querySelector<HTMLElement>(selector) : container;
    if (!element) return;
    const update = () => {
      const next = readHorizontalOverflow(element);
      setOverflow(current => current.start === next.start && current.end === next.end ? current : next);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(element);
    for (const child of Array.from(element.children)) resize?.observe(child);
    return () => {
      element.removeEventListener('scroll', update);
      resize?.disconnect();
    };
  }, [ref, selector]);

  return overflow;
}
