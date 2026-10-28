import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useWindowTier } from '../../lib/breakpoints';
import { classifyGesture, settleOpen } from '../../lib/rowSwipe';

type SwipeableRowProps = {
  children: ReactNode;
  actions: ReactNode;
  desktopActions?: ReactNode;
  actionsWidth?: number;
  actionsLabel?: string;
  className?: string;
  /// Renders only the variant for the current window tier instead of both copies hidden by CSS,
  /// for rows whose children hold live state (inputs, timers) that must exist once.
  adaptive?: boolean;
};

function clampOffset(value: number, actionsWidth: number) {
  return Math.max(-actionsWidth, Math.min(0, value));
}

/// A small, dependency-free row drawer. The content remains opaque while it moves so the action
/// tray never leaks through, and only horizontal movement takes ownership of a touch gesture.
export function SwipeableRow({
  children,
  actions,
  desktopActions,
  actionsWidth = 92,
  actionsLabel = 'Row actions',
  className = '',
  adaptive = false
}: SwipeableRowProps) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pointer = useRef<{
    id: number;
    startX: number;
    startY: number;
    lastX: number;
    lastTime: number;
    velocity: number;
    tracking: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setOffset(0);
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointer.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: event.timeStamp || Date.now(),
      velocity: 0,
      tracking: false
    };
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.tracking) {
      const gesture = classifyGesture(dx, dy);
      if (gesture === 'undecided') return;
      if (gesture === 'vertical') {
        pointer.current = null;
        return;
      }
      current.tracking = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can be unavailable for synthetic or interrupted gestures; the row can
        // still finish from the movement itself.
      }
      setDragging(true);
    }
    const now = event.timeStamp || Date.now();
    const dt = Math.max(1, now - current.lastTime);
    current.velocity = (event.clientX - current.lastX) / dt;
    current.lastX = event.clientX;
    current.lastTime = now;
    event.preventDefault();
    const origin = open ? -actionsWidth : 0;
    setOffset(clampOffset(origin + dx, actionsWidth));
  }, [actionsWidth, open]);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = pointer.current;
    pointer.current = null;
    if (!current || current.id !== event.pointerId || !current.tracking) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Already released by the browser; the row still settles below.
      }
    }
    setDragging(false);
    suppressClick.current = true;
    window.requestAnimationFrame(() => { suppressClick.current = false; });
    const now = event.timeStamp || Date.now();
    const velocity = (now - current.lastTime > 80) ? 0 : current.velocity;
    const shouldOpen = settleOpen({
      wasOpen: open,
      offset,
      velocityPxPerMs: velocity,
      actionsWidth
    });
    setOpen(shouldOpen);
    setOffset(shouldOpen ? -actionsWidth : 0);
  }, [actionsWidth, offset, open]);

  const handlePointerCancel = useCallback(() => {
    const current = pointer.current;
    pointer.current = null;
    setDragging(false);
    if (!current || !current.tracking) {
      close();
      return;
    }
    const shouldOpen = settleOpen({
      wasOpen: open,
      offset,
      velocityPxPerMs: 0,
      actionsWidth
    });
    setOpen(shouldOpen);
    setOffset(shouldOpen ? -actionsWidth : 0);
  }, [actionsWidth, close, offset, open]);

  const tier = useWindowTier();
  const showDesktop = !adaptive || tier !== 'compact';
  const showMobile = !adaptive || tier === 'compact';

  return <>
    {showDesktop && <div className={`swipeable-row-desktop ${className}`.trim()}>
      <div className="swipeable-row-desktop-content">{children}</div>
      <div className="swipeable-row-desktop-actions">{desktopActions ?? actions}</div>
    </div>}
    {showMobile && <div className={`swipeable-row-mobile ${className}`.trim()} data-swipe-ignore="" style={{ '--swipe-actions-width': `${actionsWidth}px` } as CSSProperties}>
      <div
        className="swipeable-row-actions"
        role="group"
        aria-label={actionsLabel}
        aria-hidden={!open}
        inert={!(open || offset !== 0 || dragging)}
        style={{ visibility: (open || offset !== 0 || dragging) ? undefined : 'hidden' }}
      >
        {actions}
      </div>
      {/* The row owns its sideways drag, so a surrounding page swipe (useHorizontalSwipe) leaves it alone. */}
      <div
        className="swipeable-row-surface"
        data-swipe-ignore=""
        data-swipe-open={open ? 'true' : 'false'}
        style={{ transform: `translate3d(${offset}px, 0, 0)`, transition: dragging ? 'none' : undefined }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={handlePointerCancel}
        onClick={() => { if (!suppressClick.current && open) close(); }}
        onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); close(); } }}
      >
        {children}
      </div>
    </div>}
  </>;
}
