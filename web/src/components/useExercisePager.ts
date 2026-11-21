import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { healPageReachability } from '../lib/pageReachability';
import { pageDragOffset, pageEntryOffset, pageSwipeOutcome, pushedPastEdge, type PageEdges } from '../lib/pageSwipe';
import { haptic } from '../lib/platform';
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
    // The turn has settled once its animation has run; a page left unreachable by it is repaired then.
    const check = window.setTimeout(() => healPageReachability(page.current), reduced ? 60 : 380);
    return () => window.clearTimeout(check);
  }, [pageKey]);

  // Coming back from the background is when the page most often turns out to be unreachable.
  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (document.visibilityState === 'visible') healPageReachability(page.current); }, 150);
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('workout:resume', check);
    window.addEventListener('pageshow', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('workout:resume', check);
      window.removeEventListener('pageshow', check);
    };
  }, []);

  // A touch that lands on the scroller where the page is drawn means the page cannot be reached:
  // repair it now, so the next tap works, rather than leave it until the next turn.
  function onPointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
    const element = page.current;
    if (element && event.target === element.parentElement) healPageReachability(element);
  }

  const swipe = useHorizontalSwipe({
    enabled: enabled && count > 1,
    onPrevious: () => { haptic('tick'); onSelect(index - 1); },
    onNext: () => { haptic('tick'); onSelect(index + 1); },
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
    decide: (dx, velocity) => {
      const width = page.current?.offsetWidth ?? window.innerWidth;
      if (pushedPastEdge(dx, velocity, width, edges)) haptic('detent');
      return pageSwipeOutcome(dx, velocity, width, edges);
    }
  });

  return { page, swipe: { ...swipe, onPointerDownCapture } };
}
