import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus } from 'lucide-react';
import { Button } from './Button';
import { useAnchoredLayer } from './useAnchoredLayer';
import './RpeControl.css';

export const RPE_STEPS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const;

export interface RpeControlProps {
  name?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
  compact?: boolean;
}

export function RpeControl({
  name,
  value,
  onChange,
  disabled = false,
  ariaLabel = 'Rate of Perceived Exertion (RPE)',
  compact = false
}: RpeControlProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { style: dropdownStyle, portalTarget } = useAnchoredLayer({
    open,
    triggerRef,
    layerRef: popoverRef,
    align: 'start',
    minWidth: 200,
    maxWidth: 220,
    maxHeight: 260,
    offset: 5
  });

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const stepDown = () => {
    if (disabled) return;
    if (value === null) {
      onChange(8);
      return;
    }
    if (value <= 6) {
      onChange(null);
      return;
    }
    const next = Math.round((value - 0.5) * 10) / 10;
    onChange(Math.max(6, next));
  };

  const stepUp = () => {
    if (disabled) return;
    if (value === null) {
      onChange(8);
      return;
    }
    if (value >= 10) return;
    const next = Math.round((value + 0.5) * 10) / 10;
    onChange(Math.min(10, next));
  };

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      stepDown();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      stepUp();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`rpe-control ${compact ? 'compact' : ''} ${disabled ? 'disabled' : ''} ${open ? 'open' : ''}`}
      onKeyDown={handleKeyDown}
    >
      {name && <input type="hidden" name={name} value={value ?? ''} />}

      <Button
        presentation="plain"
        type="button"
        disabled={disabled || value === null}
        className="rpe-step-btn rpe-step-down"
        aria-label="Decrease RPE"
        onClick={stepDown}
      >
        <Minus size={13} />
      </Button>

      <Button
        ref={triggerRef}
        presentation="plain"
        type="button"
        disabled={disabled}
        className="rpe-value-btn"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
      >
        <span className="rpe-value-text">{value !== null ? value : '—'}</span>
      </Button>

      <Button
        presentation="plain"
        type="button"
        disabled={disabled || (value !== null && value >= 10)}
        className="rpe-step-btn rpe-step-up"
        aria-label="Increase RPE"
        onClick={stepUp}
      >
        <Plus size={13} />
      </Button>

      {open && portalTarget && createPortal(
        <div
          ref={popoverRef}
          className="rpe-popover"
          style={dropdownStyle ?? { visibility: 'hidden' }}
          role="dialog"
          aria-label="Select RPE"
        >
          <div className="rpe-popover-header">
            <span className="rpe-popover-title">Target RPE</span>
            <Button
              presentation="plain"
              className="rpe-clear-btn"
              onClick={() => {
                onChange(null);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              Clear (—)
            </Button>
          </div>
          <div className="rpe-popover-grid">
            {RPE_STEPS.map(step => {
              const isSelected = value === step;
              const rir = Math.round((10 - step) * 10) / 10;
              return (
                <Button
                  key={step}
                  presentation="plain"
                  className={`rpe-pill ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(step);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <strong>{step}</strong>
                  <small>{rir === 0 ? 'Max' : `${rir} RIR`}</small>
                </Button>
              );
            })}
          </div>
        </div>,
        portalTarget
      )}
    </div>
  );
}
