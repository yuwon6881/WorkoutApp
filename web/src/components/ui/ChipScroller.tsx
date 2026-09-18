import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

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
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const element = chipsRef.current;
    if (!element) return;
    setCanScrollLeft(element.scrollLeft > 2);
    setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const element = chipsRef.current;
    if (!element) return;
    element.scrollLeft = 0;
    const frame = window.requestAnimationFrame(checkScroll);
    element.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(checkScroll);
    observer?.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      element.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
      observer?.disconnect();
    };
  }, [checkScroll, resetKey]);

  const scroll = (direction: 'left' | 'right') => {
    const element = chipsRef.current;
    if (!element) return;
    element.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' });
  };

  return <div className="filter-chips-nav">
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
