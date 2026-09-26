import { useRef, useState } from 'react';
import { Flame } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';
import './RpeControl.css';

export const RIR_OPTIONS = [
  { value: 0, label: '0 RIR', sub: 'Max effort / Failure' },
  { value: 1, label: '1 RIR', sub: '1 rep in reserve' },
  { value: 2, label: '2 RIR', sub: '2 reps in reserve' },
  { value: 3, label: '3 RIR', sub: '3 reps in reserve' },
  { value: 4, label: '4 RIR', sub: '4 reps in reserve' },
  { value: 5, label: '5+ RIR', sub: 'Light / Warm-up effort' },
] as const;

export const RIR_STEPS = [0, 1, 2, 3, 4] as const;
export const RPE_STEPS = RIR_STEPS;

export function getRirColorClass(value: number | null): string {
  if (value === null) return '';
  const rounded = Math.round(value);
  if (rounded <= 0) return 'rir-tier-0';
  if (rounded === 1) return 'rir-tier-1';
  if (rounded === 2) return 'rir-tier-2';
  return 'rir-tier-easy';
}

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
  const triggerRef = useRef<HTMLButtonElement>(null);

  const displayValue = value !== null ? (value >= 5 ? '5+' : String(Math.round(value))) : null;

  return (
    <div
      className={[
        'rpe-control',
        compact && 'compact',
        disabled && 'disabled',
        displayValue !== null ? 'has-value' : 'is-empty',
        displayValue !== null && getRirColorClass(value),
        open && 'open'
      ].filter(Boolean).join(' ')}
    >
      {name && <input type="hidden" name={name} value={value ?? ''} />}

      <Button
        ref={triggerRef}
        presentation="plain"
        type="button"
        disabled={disabled}
        className="rpe-value-btn"
        aria-label={displayValue !== null ? `${ariaLabel}: ${displayValue}` : ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {displayValue !== null ? (
          <span className="rpe-value-text">{displayValue}</span>
        ) : (
          <>
            <Flame size={17} className="rpe-effort-icon" aria-hidden="true" />
            <span className="rpe-empty-marker">—</span>
          </>
        )}
      </Button>

      {open && (
        <Modal
          title="Select RIR"
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        >
          <div className="rir-modal-content">
            <p className="rir-modal-desc">
              Select how many reps you could perform before reaching failure:
            </p>
            <div className="rir-modal-grid">
              {RIR_OPTIONS.map(opt => {
                const isSelected =
                  value !== null &&
                  (opt.value === 5 ? value >= 5 : Math.round(value) === opt.value);
                return (
                  <Button
                    key={opt.value}
                    presentation="plain"
                    className={`rir-option-card ${getRirColorClass(opt.value)} ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                  >
                    <div className="rir-option-num">{opt.value === 5 ? '5+' : opt.value}</div>
                    <div className="rir-option-text">
                      <strong>{opt.label}</strong>
                      <small>{opt.sub}</small>
                    </div>
                  </Button>
                );
              })}
            </div>
            <div className="rir-modal-actions">
              <Button
                variant="tertiary"
                className="rir-clear-action"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                Clear effort (unset)
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/// The same RIR choice as a row of chips, for the set being logged: one tap sets the effort and a
/// second tap on the chosen chip clears it. Tiers keep the same colours as the dialog cards.
export function RirChips({
  value,
  onChange,
  ariaLabel,
  disabled = false
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const selected = value === null ? null : value >= 5 ? 5 : Math.round(value);
  return (
    <div className="rir-chips" role="radiogroup" aria-label={ariaLabel}>
      {RIR_OPTIONS.map(option => {
        const checked = selected === option.value;
        return (
          <Button
            key={option.value}
            presentation="plain"
            role="radio"
            aria-checked={checked}
            aria-label={`${option.label}, ${option.sub}`}
            disabled={disabled}
            className={`rir-chip ${getRirColorClass(option.value)} ${checked ? 'selected' : ''}`.trim()}
            onClick={() => onChange(checked ? null : option.value)}
          >
            {option.value === 5 ? '5+' : option.value}
          </Button>
        );
      })}
    </div>
  );
}
