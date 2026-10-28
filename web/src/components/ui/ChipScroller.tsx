import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { useReducedMotion } from './Motion';
import { readHorizontalOverflow } from '../useHorizontalOverflow';

export function ChipScroller({
  ariaLabel,
  children,
  resetKey = '',
  role = 'group',
  leftLabel = 'Scroll filters left',
  rightLabel = 'Scroll filters right'
}: {
  ariaLabel: string;
  children: ReactNode;
  resetKey?: string;
  role?: 'group' | 'tablist';
  leftLabel?: string;
  rightLabel?: string;
}) {
  const chipsRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const element = chipsRef.current;
    if (!element) return;
    const overflow = readHorizontalOverflow(element);
    setCanScrollLeft(overflow.start);
    setCanScrollRight(overflow.end);
  }, []);

  useEffect(() => {
    const element = chipsRef.current;
    if (!element) return;
    element.scrollLeft = 0;
    const frame = window.requestAnimationFrame(checkScroll);
    element.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    // The chips grow without the strip changing size (a week added, a label renamed, a font
    // arriving), so each chip is watched too; otherwise an overflowing strip can show no arrow.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(checkScroll);
    observer?.observe(element);
    for (const chip of element.children) observer?.observe(chip);
    return () => {
      window.cancelAnimationFrame(frame);
      element.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
      observer?.disconnect();
    };
  }, [checkScroll, resetKey]);

  /// One press pages by most of what is visible, landing on a chip edge: the first chip cut off
  /// at the far edge becomes the first chip shown, so nothing is skipped and nothing is repeated
  /// more than the chip that was half visible.
  const scroll = (direction: 'left' | 'right') => {
    const element = chipsRef.current;
    if (!element) return;
    const view = element.getBoundingClientRect();
    const chips = [...element.children].map(chip => chip.getBoundingClientRect());
    const page = Math.max(element.clientWidth * 0.85, 120);
    let delta = direction === 'right' ? page : -page;
    if (direction === 'right') {
      const cut = chips.find(chip => chip.right > view.right + 1);
      if (cut && cut.left - view.left > 0) delta = Math.min(page, cut.left - view.left);
    } else {
      const cut = [...chips].reverse().find(chip => chip.left < view.left - 1);
      if (cut && view.right - cut.right > 0) delta = -Math.min(page, view.right - cut.right);
    }
    element.scrollBy({ left: delta, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  // The classes let a strip drop its arrows (and their space) when every chip already fits, and
  // fade only the edge that hides a chip.
  const overflowClass = canScrollLeft || canScrollRight ? ' has-overflow' : '';
  const endClass = canScrollRight ? ' can-scroll-right' : '';
  return <div className={`filter-chips-nav${overflowClass}${endClass}`}>
    <Button presentation="plain" className="filter-nav-btn" aria-label={leftLabel}
      disabled={!canScrollLeft} onClick={() => scroll('left')}>
      <ChevronLeft size={18} />
    </Button>
    <div className="filter-chips" ref={chipsRef} role={role} aria-label={ariaLabel}>
      {children}
    </div>
    <Button presentation="plain" className="filter-nav-btn" aria-label={rightLabel}
      disabled={!canScrollRight} onClick={() => scroll('right')}>
      <ChevronRight size={18} />
    </Button>
  </div>;
}
