import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus } from 'lucide-react';
import { Button } from './Button';
import { useAnchoredLayer } from './useAnchoredLayer';
import './RpeControl.css';

export const RIR_STEPS = [0, 1, 2, 3, 4] as const;
export const RPE_STEPS = RIR_STEPS;

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
  ariaLabel = 'Reps in Reserve (RIR)',
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
    maxWidth: 240,
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
      onChange(2);
      return;
    }
    if (value <= 0) {
      onChange(null);
      return;
    }
    const next = Math.round(value - 1);
    onChange(Math.max(0, next));
  };

  const stepUp = () => {
    if (disabled) return;
    if (value === null) {
      onChange(2);
      return;
    }
    if (value >= 4) return;
    const next = Math.round(value + 1);
    onChange(Math.min(4, next));
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

      {!compact && (
        <Button
          presentation="plain"
          type="button"
          disabled={disabled || value === null}
          className="rpe-step-btn rpe-step-down"
          aria-label="Decrease RIR"
          onClick={stepDown}
        >
          <Minus size={13} />
        </Button>
      )}

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
        <span className="rpe-value-text">{value !== null ? `${Math.round(value)} RIR` : '—'}</span>
      </Button>

      {!compact && (
        <Button
          presentation="plain"
          type="button"
          disabled={disabled || (value !== null && value >= 4)}
          className="rpe-step-btn rpe-step-up"
          aria-label="Increase RIR"
          onClick={stepUp}
        >
          <Plus size={13} />
        </Button>
      )}

      {open && portalTarget && createPortal(
        <div
          ref={popoverRef}
          className="rpe-popover"
          style={dropdownStyle ?? { visibility: 'hidden' }}
          role="dialog"
          aria-label="Select RIR"
        >
          <div className="rpe-popover-header">
            <span className="rpe-popover-title">Target RIR</span>
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
            {RIR_STEPS.map(step => {
              const isSelected = value !== null && Math.round(value) === step;
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
                  <small>{step === 0 ? 'Max' : `${step} RIR`}</small>
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
