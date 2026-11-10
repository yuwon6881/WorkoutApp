import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { windowTier } from '../../lib/breakpoints';
import { haptic } from '../../lib/platform';
import { GestureVelocity } from '../../lib/gestureVelocity';

const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 0.6; // px per ms, a deliberate flick
const SETTLE_MS = 180;
const INTERACTIVE = 'button,input,select,textarea,a,[role=button],[role=option],[role=slider],[contenteditable=true]';

type Drag = {
  pointerId: number;
  startY: number;
  lastPreDrag: { y: number; at: number };
  velocity: GestureVelocity;
  moved: boolean;
};

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function eventTime(timeStamp: number) {
  return typeof timeStamp === 'number' && Number.isFinite(timeStamp) ? timeStamp : Date.now();
}

// On compact layouts a dialog is a bottom sheet with a grab handle. Dragging its header (or any
// element marked data-sheet-handle) down past a distance, or flicking it, closes it the same way
// the close button does; a shorter drag springs back. Controls inside the handle keep their taps.
export function useSheetDrag(ref: RefObject<HTMLDialogElement | null>, onDismiss: () => void) {
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragOffset = useRef(0);
  useEffect(() => () => { cancelAnimationFrame(frame.current); clearTimeout(dismissTimer.current); }, []);

  const reset = useCallback((element: HTMLDialogElement, animate: boolean) => {
    element.style.transition = animate && !reducedMotion() ? `transform ${SETTLE_MS}ms ease-out` : '';
    element.style.transform = '';
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDialogElement>) => {
    const element = ref.current;
    const target = event.target as HTMLElement | null;
    if (!element || !target || windowTier() !== 'compact' || event.button !== 0 || drag.current?.moved) return;
    const rect = element.getBoundingClientRect();
    const onGrabStrip = event.clientY >= rect.top && event.clientY - rect.top < 24;
    const onHandle = Boolean(target.closest('dialog > header, [data-sheet-handle]'));
    if ((!onGrabStrip && !onHandle) || target.closest(INTERACTIVE)) return;
    const at = eventTime(event.timeStamp);
    const velocity = new GestureVelocity();
    velocity.add(event.clientY, at);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, lastPreDrag: { y: event.clientY, at }, velocity, moved: false };
  }, [ref]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDialogElement>) => {
    const element = ref.current;
    const current = drag.current;
    if (!element || !current || current.pointerId !== event.pointerId) return;
    const at = eventTime(event.timeStamp);
    const offset = Math.max(0, event.clientY - current.startY);
    if (!current.moved && offset < 6) {
      current.lastPreDrag = { y: event.clientY, at };
      return;
    }
    if (!current.moved) {
      current.moved = true;
      element.setPointerCapture?.(event.pointerId);
      // Pre-slop movement within the velocity window belongs to the flick itself when the gesture
      // started after resting a finger on the handle past 60 ms.
      if (at > current.lastPreDrag.at && at - current.lastPreDrag.at <= 60) {
        current.velocity.add(current.lastPreDrag.y, current.lastPreDrag.at);
      }
    }
    current.velocity.add(event.clientY, at);
    dragOffset.current = offset;
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      element.style.transition = '';
      element.style.transform = `translateY(${dragOffset.current}px)`;
    });
  }, [ref]);

  const finish = useCallback((event: ReactPointerEvent<HTMLDialogElement>) => {
    const element = ref.current;
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0;
    if (!element || !current.moved) return;
    const at = eventTime(event.timeStamp);
    const offset = Math.max(0, event.clientY - current.startY);
    const dismiss = event.type === 'pointerup' && (offset > Math.min(DISMISS_DISTANCE, element.offsetHeight * 0.3) || current.velocity.at(at) > DISMISS_VELOCITY);
    if (!dismiss) { reset(element, true); return; }
    haptic('tick');
    if (reducedMotion()) { onDismiss(); return; }
    element.style.transition = `transform ${SETTLE_MS}ms ease-in`;
    element.style.transform = 'translateY(100%)';
    dismissTimer.current = setTimeout(onDismiss, SETTLE_MS);
  }, [ref, onDismiss, reset]);

  return { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish };
}
