import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { SlotItem } from '../lib/activeSlot';
import { useReducedMotion } from './ui/Motion';
import { useEdgeAutoScroll } from './useEdgeAutoScroll';

export type SlotZone = 'active' | 'library';

export type SlotDragState = {
  item: SlotItem;
  from: SlotZone;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  overZone: SlotZone | null;
  returning: boolean;
};

type PendingPointer = {
  id: number;
  item: SlotItem;
  from: SlotZone;
  startX: number;
  startY: number;
  rect: DOMRect;
  timer?: number;
  armed: boolean;
};

const MOUSE_THRESHOLD = 6;
const TOUCH_SLOP = 8;
const LONG_PRESS_MS = 260;
const RETURN_MS = 220;

function zoneAt(x: number, y: number): SlotZone | null {
  const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot-zone]')?.dataset.slotZone;
  return zone === 'active' || zone === 'library' ? zone : null;
}

/// Moves a workout between the active slot and the library. A mouse drags a card by its header
/// after a short movement; touch and pen drag by the grip after a long press, so scrolling the
/// page past a card never picks it up. Keyboard and screen-reader users use the card menu, which
/// calls the same drop handler.
export function useWorkoutSlotDrag(onDrop: (item: SlotItem, from: SlotZone, to: SlotZone) => void) {
  const [drag, setDrag] = useState<SlotDragState | null>(null);
  const dragRef = useRef<SlotDragState | null>(null);
  const pending = useRef<PendingPointer | null>(null);
  const returnTimer = useRef<number | undefined>(undefined);
  const reducedMotion = useReducedMotion();
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  // A phone rarely shows the library card and the active slot at once, so a drag held near an
  // edge scrolls the page and keeps the zone under the still pointer up to date.
  const edge = useEdgeAutoScroll(useCallback(() => {
    const state = dragRef.current;
    const point = lastPointer.current;
    if (!state || !point) return;
    const overZone = zoneAt(point.x, point.y);
    if (overZone !== state.overZone) {
      dragRef.current = { ...state, overZone };
      setDrag(dragRef.current);
    }
  }, []));

  const update = useCallback((next: SlotDragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(returnTimer.current);
    if (pending.current?.timer != null) window.clearTimeout(pending.current.timer);
  }, []);

  const arm = useCallback((current: PendingPointer, x: number, y: number, target: HTMLElement) => {
    current.armed = true;
    try {
      target.setPointerCapture(current.id);
    } catch {
      // Pointer capture is unavailable for synthetic pointers; the drag still tracks movement.
    }
    update({
      item: current.item, from: current.from, x, y,
      offsetX: current.startX - current.rect.left, offsetY: current.startY - current.rect.top,
      width: current.rect.width, overZone: zoneAt(x, y), returning: false
    });
  }, [update]);

  // An abandoned drag glides back to where it was picked up, unless motion is reduced.
  const springBack = useCallback(() => {
    const state = dragRef.current;
    const origin = pending.current;
    if (!state || !origin || reducedMotion) { update(null); return; }
    update({ ...state, x: origin.startX, y: origin.startY, overZone: null, returning: true });
    returnTimer.current = window.setTimeout(() => update(null), RETURN_MS);
  }, [reducedMotion, update]);

  const handlers = useCallback((item: SlotItem, from: SlotZone) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const target = event.target as HTMLElement;
      const onGrip = Boolean(target.closest('[data-slot-grip]'));
      // A mouse may grab the card anywhere except its own controls; touch only by the grip.
      if (event.pointerType === 'mouse' ? !onGrip && target.closest('button, a, input, textarea, [role="menu"], [role="dialog"]') : !onGrip) return;
      window.clearTimeout(returnTimer.current);
      const card = event.currentTarget;
      const current: PendingPointer = {
        id: event.pointerId, item, from, startX: event.clientX, startY: event.clientY,
        rect: card.getBoundingClientRect(), armed: false
      };
      if (event.pointerType === 'mouse') {
        // A quick flick can leave the card before the drag threshold is met; capture keeps the
        // following moves on the card so the drag still starts.
        try { card.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }
      } else {
        current.timer = window.setTimeout(() => {
          if (pending.current === current) arm(current, current.startX, current.startY, card);
        }, LONG_PRESS_MS);
      }
      pending.current = current;
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const current = pending.current;
      if (!current || current.id !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      if (!current.armed) {
        if (event.pointerType === 'mouse') {
          if (distance < MOUSE_THRESHOLD) return;
          arm(current, event.clientX, event.clientY, event.currentTarget);
        } else {
          if (distance > TOUCH_SLOP) {
            window.clearTimeout(current.timer);
            pending.current = null;
          }
          return;
        }
      }
      event.preventDefault();
      const state = dragRef.current;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      edge.update(event.clientY);
      if (state) update({ ...state, x: event.clientX, y: event.clientY, overZone: zoneAt(event.clientX, event.clientY) });
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const current = pending.current;
      if (!current || current.id !== event.pointerId) return;
      window.clearTimeout(current.timer);
      edge.stop();
      const state = dragRef.current;
      if (!current.armed || !state) { pending.current = null; return; }
      const to = zoneAt(event.clientX, event.clientY);
      if (to && to !== current.from) {
        update(null);
        pending.current = null;
        onDrop(current.item, current.from, to);
        return;
      }
      springBack();
      pending.current = null;
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
      const current = pending.current;
      if (!current || current.id !== event.pointerId) return;
      window.clearTimeout(current.timer);
      edge.stop();
      if (current.armed) springBack();
      pending.current = null;
    },
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      // A long press on the grip would otherwise open the system menu on Android.
      if ((event.target as HTMLElement).closest('[data-slot-grip]')) event.preventDefault();
    }
  }), [arm, edge, onDrop, springBack, update]);

  return { drag, handlers };
}
