import { useLayoutEffect, useRef } from 'react';
import { pageDragOffset, pageEntryOffset, pageSwipeOutcome, type PageEdges } from '../lib/pageSwipe';
import { useHorizontalSwipe } from './ui/useHorizontalSwipe';
import { useReducedMotion } from './ui/Motion';

const SETTLE_EASE = 'cubic-bezier(.32, .72, 0, 1)';

/// The active workout's exercise pages. A sideways drag moves the open page with the finger and
/// either turns it or springs it back; however the page changes (a swipe, a strip tab, the move to
/// the next exercise after a set), the arriving page slides in from the side it comes from and the
/// body returns to its top. Motion is skipped when reduced motion is preferred; the drag still
/// tracks the finger, since that is direct manipulation rather than decoration.
export function useExercisePager({ index, pageKey, count, enabled, onSelect }: {
  index: number;
  /** The open exercise; a reorder moves its index without turning the page. */
  pageKey: string | undefined;
  count: number;
  enabled: boolean;
  onSelect: (index: number) => void;
}) {
  const page = useRef<HTMLDivElement>(null);
  const previous = useRef({ index, pageKey });
  const running = useRef<Animation | null>(null);
  const reduced = useReducedMotion();
  const edges: PageEdges = { canPrevious: index > 0, canNext: index < count - 1 };

  function stopMotion(element: HTMLElement) {
    running.current?.cancel();
    running.current = null;
    element.style.transform = '';
    element.style.opacity = '';
    element.classList.remove('dragging');
  }

  function settle(element: HTMLElement, keyframes: Keyframe[], duration: number) {
    stopMotion(element);
    if (reduced || typeof element.animate !== 'function') return;
    const animation = element.animate(keyframes, { duration, easing: SETTLE_EASE });
    running.current = animation;
    animation.onfinish = () => { if (running.current === animation) running.current = null; };
  }

  useLayoutEffect(() => {
    const element = page.current;
    const from = previous.current;
    previous.current = { index, pageKey };
    if (!element || from.pageKey === pageKey) return;
    const body = element.parentElement;
    if (body) body.scrollTop = 0;
    const offset = pageEntryOffset(index >= from.index ? 1 : -1, element.offsetWidth);
    settle(element, [
      { transform: `translate3d(${offset}px, 0, 0)`, opacity: 0 },
      { transform: 'translate3d(0, 0, 0)', opacity: 1 }
    ], 320);
  }, [pageKey]);

  const swipe = useHorizontalSwipe({
    enabled: enabled && count > 1,
    onPrevious: () => onSelect(index - 1),
    onNext: () => onSelect(index + 1),
    onDrag: dx => {
      const element = page.current;
      if (!element) return;
      if (running.current) { running.current.cancel(); running.current = null; }
      element.classList.add('dragging');
      element.style.transform = `translate3d(${pageDragOffset(dx, edges)}px, 0, 0)`;
    },
    onCancel: () => {
      const element = page.current;
      if (!element) return;
      const from = element.style.transform || 'translate3d(0, 0, 0)';
      settle(element, [{ transform: from }, { transform: 'translate3d(0, 0, 0)' }], 280);
    },
    decide: (dx, velocity) => pageSwipeOutcome(dx, velocity, page.current?.offsetWidth ?? window.innerWidth, edges)
  });

  return { page, swipe };
}
