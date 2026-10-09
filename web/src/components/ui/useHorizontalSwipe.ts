import { useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

const SLOP = 10;
const TRIGGER = 72;
const TEXT_ENTRY = 'input, textarea, select, [contenteditable=true], [role=slider]';
/// Content that scrolls sideways itself keeps the gesture.
const OWN_SCROLL = '[data-swipe-ignore]';

export type SwipeDecision = 'previous' | 'next' | 'stay';
type Gesture = { id: number; x: number; y: number; locked: 'x' | 'y' | null; lastX: number; lastAt: number; velocity: number };

/// A left or right swipe across a surface, for moving between pages of the same kind (the
/// exercises of a workout). Vertical scrolling keeps working: the gesture only locks once the
/// finger has moved further sideways than down, and the surface should set touch-action: pan-y.
/// Swipes that start in a text field are left to the field. A surface that follows the finger
/// hears its travel through onDrag and decides the release itself; a swipe that did not turn the
/// page reports onCancel so the follower can return. The tap a swipe ends on is swallowed, so a
/// swipe that starts on a button does not also press it.
export function useHorizontalSwipe({ onPrevious, onNext, enabled = true, onDrag, onCancel, decide }: {
  onPrevious?: () => void;
  onNext?: () => void;
  enabled?: boolean;
  onDrag?: (dx: number) => void;
  onCancel?: () => void;
  /** Whether a release turns the page, from its travel and speed (px per ms). */
  decide?: (dx: number, velocity: number) => SwipeDecision;
}) {
  const start = useRef<Gesture | null>(null);
  // Until when a click belongs to the swipe that just ended rather than to a new tap.
  const swallowClickUntil = useRef(0);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (!enabled || event.pointerType === 'mouse' || target.closest(TEXT_ENTRY) || target.closest(OWN_SCROLL)) return;
    // React bubbles events out of portals, so a dialog opened from the surface is not part of it.
    if (!event.currentTarget.contains(target)) return;
    start.current = { id: event.pointerId, x: event.clientX, y: event.clientY, locked: null, lastX: event.clientX, lastAt: event.timeStamp, velocity: 0 };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = start.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.locked) {
      const dx = Math.abs(event.clientX - current.x);
      const dy = Math.abs(event.clientY - current.y);
      if (dx < SLOP && dy < SLOP) return;
      current.locked = dx > dy ? 'x' : 'y';
      if (current.locked === 'y') return;
    }
    if (current.locked !== 'x') return;
    const elapsed = Math.max(1, event.timeStamp - current.lastAt);
    current.velocity = (event.clientX - current.lastX) / elapsed;
    current.lastX = event.clientX;
    current.lastAt = event.timeStamp;
    onDrag?.(event.clientX - current.x);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const current = start.current;
    start.current = null;
    if (!current || current.id !== event.pointerId || current.locked !== 'x') return;
    swallowClickUntil.current = event.timeStamp + 350;
    const dx = event.clientX - current.x;
    // A pause before lifting the finger is not a flick.
    const velocity = event.timeStamp - current.lastAt > 80 ? 0 : current.velocity;
    const decision = decide ? decide(dx, velocity) : dx <= -TRIGGER ? 'next' : dx >= TRIGGER ? 'previous' : 'stay';
    if (decision === 'next' && onNext) onNext();
    else if (decision === 'previous' && onPrevious) onPrevious();
    else onCancel?.();
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    const current = start.current;
    start.current = null;
    if (current?.id === event.pointerId && current.locked === 'x') onCancel?.();
  }

  function onClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (event.timeStamp > swallowClickUntil.current) return;
    swallowClickUntil.current = 0;
    event.preventDefault();
    event.stopPropagation();
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture };
}
