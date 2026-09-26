import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useReducedMotion } from './Motion';

type SwipeableRowProps = {
  children: ReactNode;
  actions: ReactNode;
  desktopActions?: ReactNode;
  actionsWidth?: number;
  actionsLabel?: string;
  className?: string;
  /// Slides this row part-way open and back once, the first time any peeking row scrolls into view
  /// on a touch layout, so the hidden action is discoverable without reading instructions.
  peek?: boolean;
};

const PEEK_OFFSET = 44;
const PEEK_HOLD_MS = 520;
let peekShown = false;

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
  peek = false
}: SwipeableRowProps) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pointer = useRef<{ id: number; startX: number; startY: number; tracking: boolean } | null>(null);
  const suppressClick = useRef(false);
  const mobileRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const node = mobileRef.current;
    if (!peek || peekShown || reducedMotion || !node || typeof IntersectionObserver === 'undefined') return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(entries => {
      // The mobile variant is display:none on wider layouts, so it never intersects there.
      if (peekShown || !entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.9)) return;
      peekShown = true;
      observer.disconnect();
      setOffset(-Math.min(PEEK_OFFSET, actionsWidth));
      timer = window.setTimeout(() => {
        if (!pointer.current) setOffset(current => current === -Math.min(PEEK_OFFSET, actionsWidth) ? 0 : current);
      }, PEEK_HOLD_MS);
    }, { threshold: 0.9 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [actionsWidth, peek, reducedMotion]);

  const close = useCallback(() => {
    setOpen(false);
    setOffset(0);
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointer.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, tracking: false };
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.tracking) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        pointer.current = null;
        return;
      }
      current.tracking = true;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {
        // Pointer capture can be unavailable for synthetic or interrupted gestures; the row can
        // still finish from the movement itself.
      }
      setDragging(true);
    }
    event.preventDefault();
    const origin = open ? -actionsWidth : 0;
    setOffset(clampOffset(origin + dx, actionsWidth));
  }, [actionsWidth, open]);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = pointer.current;
    pointer.current = null;
    if (!current || current.id !== event.pointerId || !current.tracking) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    suppressClick.current = true;
    window.requestAnimationFrame(() => { suppressClick.current = false; });
    const dx = event.clientX - current.startX;
    const shouldOpen = offset < -actionsWidth / 2 || dx < -actionsWidth / 2;
    setOpen(shouldOpen);
    setOffset(shouldOpen ? -actionsWidth : 0);
  }, [actionsWidth, offset]);

  const handlePointerCancel = useCallback(() => {
    pointer.current = null;
    setDragging(false);
    close();
  }, [close]);

  return <>
    <div className={`swipeable-row-desktop ${className}`.trim()}>
      <div className="swipeable-row-desktop-content">{children}</div>
      <div className="swipeable-row-desktop-actions">{desktopActions ?? actions}</div>
    </div>
    <div ref={mobileRef} className={`swipeable-row-mobile ${className}`.trim()} style={{ '--swipe-actions-width': `${actionsWidth}px` } as CSSProperties}>
      <div className="swipeable-row-actions" role="group" aria-label={actionsLabel} aria-hidden={!open} inert={!open}>
        {actions}
      </div>
      <div
        className="swipeable-row-surface"
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
    </div>
  </>;
}
