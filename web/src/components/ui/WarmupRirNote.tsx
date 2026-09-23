import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { useAnchoredLayer } from './useAnchoredLayer';
import './WarmupRirNote.css';

export interface WarmupRirNoteProps {
  compact?: boolean;
  dataImportIndex?: number;
}

export function WarmupRirNote({ compact = false, dataImportIndex }: WarmupRirNoteProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const hoverTimeoutRef = useRef<number | null>(null);

  const { portalTarget, style } = useAnchoredLayer({
    open,
    triggerRef,
    layerRef,
    align: 'end',
    minWidth: 170,
    maxWidth: 240,
    maxHeight: 180,
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
    <div
      className="field rpe-field warmup-rir-note"
      data-import-field="targetRpe"
      data-import-set-index={dataImportIndex}
    >
      <span>Target RIR</span>
      <Button
        ref={triggerRef}
        presentation="plain"
        type="button"
        className={`warmup-rir-trigger ${compact ? 'compact' : ''} ${open ? 'active' : ''}`}
        aria-label="No target for warm-ups"
        title="No target for warm-ups"
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
        <span className="warmup-rir-dash" aria-hidden="true">—</span>
        <span className="sr-only">No target for warm-ups</span>
      </Button>

      {open && portalTarget && createPortal(
        <div
          ref={layerRef}
          id={tooltipId}
          role="tooltip"
          className="warmup-rir-popover"
          style={style ?? { visibility: 'hidden' }}
          onMouseEnter={handleOpen}
          onMouseLeave={handleDelayedClose}
        >
          <strong className="warmup-rir-popover-title">No target for warm-ups</strong>
          <span className="warmup-rir-popover-desc">
            Warm-up sets are submaximal and do not track RIR. Switch set type to Normal set to assign a target.
          </span>
        </div>,
        portalTarget
      )}
    </div>
  );
}
