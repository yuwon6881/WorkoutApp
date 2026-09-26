import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { windowTier } from '../../lib/breakpoints';

const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 0.6; // px per ms, a deliberate flick
const SETTLE_MS = 180;
const INTERACTIVE = 'button,input,select,textarea,a,[role=button],[role=option],[role=slider],[contenteditable=true]';

type Drag = { pointerId: number; startY: number; lastY: number; lastAt: number; velocity: number; moved: boolean };

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// On compact layouts a dialog is a bottom sheet with a grab handle. Dragging its header (or any
// element marked data-sheet-handle) down past a distance, or flicking it, closes it the same way
// the close button does; a shorter drag springs back. Controls inside the handle keep their taps.
export function useSheetDrag(ref: RefObject<HTMLDialogElement | null>, onDismiss: () => void) {
  const drag = useRef<Drag | null>(null);

  const reset = useCallback((element: HTMLDialogElement, animate: boolean) => {
    element.style.transition = animate && !reducedMotion() ? `transform ${SETTLE_MS}ms ease-out` : '';
    element.style.transform = '';
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDialogElement>) => {
    const element = ref.current;
    const target = event.target as HTMLElement;
    if (!element || windowTier() !== 'compact' || event.button !== 0) return;
    const rect = element.getBoundingClientRect();
    const onGrabStrip = event.clientY - rect.top < 24;
    const onHandle = Boolean(target.closest('dialog > header, [data-sheet-handle]'));
    if ((!onGrabStrip && !onHandle) || target.closest(INTERACTIVE)) return;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, lastAt: event.timeStamp, velocity: 0, moved: false };
  }, [ref]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDialogElement>) => {
    const element = ref.current;
    const current = drag.current;
    if (!element || !current || current.pointerId !== event.pointerId) return;
    const offset = Math.max(0, event.clientY - current.startY);
    if (!current.moved && offset < 6) return;
    if (!current.moved) {
      current.moved = true;
      element.setPointerCapture?.(event.pointerId);
    }
    const elapsed = Math.max(1, event.timeStamp - current.lastAt);
    current.velocity = (event.clientY - current.lastY) / elapsed;
    current.lastY = event.clientY;
    current.lastAt = event.timeStamp;
    element.style.transition = '';
    element.style.transform = `translateY(${offset}px)`;
  }, [ref]);

  const finish = useCallback((event: ReactPointerEvent<HTMLDialogElement>) => {
    const element = ref.current;
    const current = drag.current;
    drag.current = null;
    if (!element || !current || current.pointerId !== event.pointerId || !current.moved) return;
    const offset = Math.max(0, event.clientY - current.startY);
    const dismiss = event.type === 'pointerup' && (offset > Math.min(DISMISS_DISTANCE, element.offsetHeight * 0.3) || current.velocity > DISMISS_VELOCITY);
    if (!dismiss) { reset(element, true); return; }
    if (reducedMotion()) { onDismiss(); return; }
    element.style.transition = `transform ${SETTLE_MS}ms ease-in`;
    element.style.transform = 'translateY(100%)';
    window.setTimeout(onDismiss, SETTLE_MS);
  }, [ref, onDismiss, reset]);

  return { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish };
}
