import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';
import { useReducedMotion } from './Motion';
import { shouldDismiss } from '../../lib/swipeDismiss';
import './SwipeDismiss.css';

const SWIPE_SLOP_PX = 6;
const DISMISS_ANIMATION_MS = 160;

export function SwipeDismiss({
  children,
  onDismiss,
  className = ''
}: {
  children: ReactNode;
  onDismiss: () => void;
  className?: string;
}) {
  const [offset, setOffset] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const pointer = useRef<{
    id: number;
    startX: number;
    startY: number;
    startTime: number;
    tracking: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (dismissing) return;
      pointer.current = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: event.timeStamp || Date.now(),
        tracking: false
      };
    },
    [dismissing]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = pointer.current;
      if (!current || current.id !== event.pointerId || dismissing) return;

      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;

      if (!current.tracking) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_SLOP_PX) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          pointer.current = null;
          return;
        }
        current.tracking = true;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture can fail for synthetic or interrupted gestures
        }
        setDragging(true);
      }

      event.preventDefault();
      setOffset(dx);
      // Fade opacity down toward 0.4 as |dx| grows
      const targetWidth = wrapperRef.current?.offsetWidth || 200;
      const progress = Math.min(1, Math.abs(dx) / (targetWidth * 0.6));
      setOpacity(Math.max(0.4, 1 - progress * 0.6));
    },
    [dismissing]
  );

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = pointer.current;
      pointer.current = null;
      if (!current || current.id !== event.pointerId || !current.tracking || dismissing) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Already released by the browser; the drag still settles below.
        }
      }
      setDragging(false);
      suppressClick.current = true;
      window.requestAnimationFrame(() => {
        suppressClick.current = false;
      });

      const dx = event.clientX - current.startX;
      const now = event.timeStamp || Date.now();
      const elapsed = Math.max(1, now - current.startTime);

      if (shouldDismiss(dx, elapsed)) {
        if (reduced) {
          onDismiss();
          return;
        }
        const width = contentRef.current?.offsetWidth || wrapperRef.current?.offsetWidth || 300;
        const targetOffset = dx < 0 ? -width : width;
        setDismissing(true);
        setOffset(targetOffset);
        setOpacity(0);
        window.setTimeout(() => {
          onDismiss();
        }, DISMISS_ANIMATION_MS);
      } else {
        setOffset(0);
        setOpacity(1);
      }
    },
    [dismissing, onDismiss, reduced]
  );

  const handlePointerCancel = useCallback(() => {
    pointer.current = null;
    setDragging(false);
    if (!dismissing) {
      setOffset(0);
      setOpacity(1);
    }
  }, [dismissing]);

  const transitionStyle = dragging
    ? 'none'
    : dismissing
      ? `transform ${DISMISS_ANIMATION_MS}ms var(--motion-ease), opacity ${DISMISS_ANIMATION_MS}ms var(--motion-ease)`
      : 'transform var(--motion-panel) var(--motion-ease), opacity var(--motion-panel) var(--motion-ease)';

  return (
    <div
      ref={wrapperRef}
      className={`swipe-dismiss ${className}`.trim()}
      data-swipe-ignore=""
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={handlePointerCancel}
      onClickCapture={e => {
        if (suppressClick.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div
        ref={contentRef}
        className="swipe-dismiss-content"
        style={{
          transform: `translate3d(${offset}px, 0, 0)`,
          opacity,
          transition: transitionStyle
        }}
      >
        {children}
      </div>
    </div>
  );
}
