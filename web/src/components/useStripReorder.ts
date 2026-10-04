import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { haptic } from '../lib/platform';

/// Long enough that a thumb resting on a pill while the strip glides is not mistaken for a grab.
const HOLD_MS = 450;
/// Any movement past this before the hold completes is a scroll, and the hold is abandoned.
const SLOP_PX = 8;
const EDGE_PX = 40;
const EDGE_STEP_PX = 12;

type Press = {
  index: number;
  pointerId: number;
  x: number;
  y: number;
  timer: number;
  active: boolean;
  /// Item centres in the strip's scroll coordinates, captured when the hold starts.
  centres: number[];
};

export type StripDrag = { from: number; to: number };

/// The order the strip shows while an item is held: the held exercise already sits where it
/// would land, so the lifter sees the result before letting go.
export function previewOrder(count: number, drag: StripDrag | null): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  if (!drag || drag.from === drag.to) return order;
  const [held] = order.splice(drag.from, 1);
  order.splice(drag.to, 0, held);
  return order;
}

/// Press and hold a strip item to pick it up, then slide it along the strip. A quick swipe stays a
/// scroll and a tap stays a selection; Alt+arrow keys move the focused item for keyboard users.
export function useStripReorder({
  scrollerRef,
  count,
  onMove
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  count: number;
  onMove: (from: number, to: number) => void;
}) {
  const [drag, setDrag] = useState<StripDrag | null>(null);
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);

  // Once an item is held the strip must stop panning under the finger. Touch scrolling can only be
  // refused from a non-passive listener, which React's synthetic handlers cannot register.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const block = (event: TouchEvent) => { if (press.current?.active) event.preventDefault(); };
    scroller.addEventListener('touchmove', block, { passive: false });
    return () => scroller.removeEventListener('touchmove', block);
  }, [scrollerRef]);

  useEffect(() => () => { if (press.current) window.clearTimeout(press.current.timer); }, []);

  function release() {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setDrag(null);
  }

  function centres(): number[] {
    const scroller = scrollerRef.current;
    if (!scroller) return [];
    const origin = scroller.getBoundingClientRect().left - scroller.scrollLeft;
    return [...scroller.querySelectorAll<HTMLElement>('[data-strip-index]')]
      .sort((a, b) => Number(a.dataset.stripIndex) - Number(b.dataset.stripIndex))
      .map(item => { const rect = item.getBoundingClientRect(); return rect.left - origin + rect.width / 2; });
  }

  function targetFor(current: Press, clientX: number): number {
    const scroller = scrollerRef.current;
    if (!scroller) return current.index;
    const bounds = scroller.getBoundingClientRect();
    if (clientX < bounds.left + EDGE_PX) scroller.scrollLeft -= EDGE_STEP_PX;
    else if (clientX > bounds.right - EDGE_PX) scroller.scrollLeft += EDGE_STEP_PX;
    const x = clientX - bounds.left + scroller.scrollLeft;
    return current.centres.filter((centre, index) => index !== current.index && centre < x).length;
  }

  function itemProps(index: number) {
    return {
      'data-strip-index': index,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (count < 2 || (event.pointerType === 'mouse' && event.button !== 0)) return;
        release();
        suppressClick.current = false;
        const pending: Press = {
          index, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, centres: [],
          timer: window.setTimeout(() => {
            pending.active = true;
            pending.centres = centres();
            // The strip, not the pill, holds the pointer: the pill's node moves as the order changes.
            try { scrollerRef.current?.setPointerCapture(pending.pointerId); } catch { /* The pointer already left. */ }
            haptic('tick');
            setDrag({ from: index, to: index });
          }, HOLD_MS)
        };
        press.current = pending;
      },
      // A long press would otherwise open the browser's context menu or text selection.
      onContextMenu: (event: MouseEvent<HTMLElement>) => { if (press.current) event.preventDefault(); },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        const to = index + (event.key === 'ArrowLeft' ? -1 : 1);
        if (to < 0 || to >= count) return;
        event.preventDefault();
        onMove(index, to);
        // Reordering moves the focused node; keep focus on the exercise that was moved.
        window.requestAnimationFrame(() => scrollerRef.current?.querySelector<HTMLElement>(`[data-strip-index="${to}"]`)?.focus());
      }
    };
  }

  const stripProps = {
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.active) {
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > SLOP_PX) release();
        return;
      }
      const to = targetFor(current, event.clientX);
      setDrag(previous => previous && previous.to === to ? previous : { from: current.index, to });
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (current.active) {
        suppressClick.current = true;
        const to = targetFor(current, event.clientX);
        if (to !== current.index) onMove(current.index, to);
      }
      release();
    },
    onPointerCancel: release,
    // The release that drops a held exercise must not also select whatever lies under it.
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return { drag, itemProps, stripProps };
}
