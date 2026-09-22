import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import { Button } from './Button';
import { useAnchoredLayer } from './useAnchoredLayer';
import './InfoTooltip.css';

export interface InfoTooltipProps {
  content: ReactNode;
  label?: string;
  align?: 'start' | 'end';
}

/// Accessible contextual help tooltip and popover. On desktop, it reveals on hover or keyboard
/// focus; on touch screens / mobile PWA, it toggles on tap and dismisses cleanly on outside interaction.
/// Portaling ensures the popover layer is never clipped by panel bounds or scrollers.
export function InfoTooltip({
  content,
  label = 'More information',
  align = 'start'
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const hoverTimeoutRef = useRef<number | null>(null);

  const { portalTarget, style } = useAnchoredLayer({
    open,
    triggerRef,
    layerRef,
    align,
    minWidth: 180,
    maxWidth: 290,
    maxHeight: 240,
    offset: 6
  });

  const clearTimer = useCallback(() => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const handleOpen = useCallback(() => {
    clearTimer();
    setOpen(true);
  }, [clearTimer]);

  const handleClose = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  const handleDelayedClose = useCallback(() => {
    clearTimer();
    hoverTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 150);
  }, [clearTimer]);

  // Dismiss on pointer interaction outside trigger and popover
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || layerRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  return (
    <span className="info-tooltip-wrap">
      <Button
        ref={triggerRef}
        presentation="plain"
        type="button"
        className={`info-tooltip-trigger ${open ? 'active' : ''}`}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={e => {
          e.stopPropagation();
          setOpen(prev => !prev);
        }}
        onMouseEnter={handleOpen}
        onMouseLeave={handleDelayedClose}
        onFocus={handleOpen}
        onBlur={handleClose}
      >
        <HelpCircle size={15} aria-hidden="true" />
      </Button>

      {open && portalTarget && createPortal(
        <div
          ref={layerRef}
          id={tooltipId}
          role="tooltip"
          className="info-tooltip-popover"
          style={style ?? { visibility: 'hidden' }}
          onMouseEnter={handleOpen}
          onMouseLeave={handleDelayedClose}
        >
          {content}
        </div>,
        portalTarget
      )}
    </span>
  );
}
