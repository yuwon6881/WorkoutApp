import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const SLOP = 10;
const TRIGGER = 72;
const TEXT_ENTRY = 'input, textarea, select, [contenteditable=true], [role=slider]';

/// A left or right swipe across a surface, for moving between pages of the same kind (the
/// exercises of a workout). Vertical scrolling keeps working: the gesture only locks once the
/// finger has moved further sideways than down, and the surface should set touch-action: pan-y.
/// Swipes that start in a text field are left to the field.
export function useHorizontalSwipe({ onPrevious, onNext, enabled = true }: {
  onPrevious?: () => void;
  onNext?: () => void;
  enabled?: boolean;
}) {
  const start = useRef<{ id: number; x: number; y: number; locked: 'x' | 'y' | null } | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!enabled || event.pointerType === 'mouse' || (event.target as HTMLElement).closest(TEXT_ENTRY)) return;
    start.current = { id: event.pointerId, x: event.clientX, y: event.clientY, locked: null };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = start.current;
    if (!current || current.id !== event.pointerId || current.locked) return;
    const dx = Math.abs(event.clientX - current.x);
    const dy = Math.abs(event.clientY - current.y);
    if (dx < SLOP && dy < SLOP) return;
    current.locked = dx > dy ? 'x' : 'y';
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const current = start.current;
    start.current = null;
    if (!current || current.id !== event.pointerId || current.locked !== 'x') return;
    const dx = event.clientX - current.x;
    if (dx <= -TRIGGER) onNext?.();
    else if (dx >= TRIGGER) onPrevious?.();
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: () => { start.current = null; } };
}
