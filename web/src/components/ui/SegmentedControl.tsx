import type { KeyboardEvent, ReactNode } from 'react';
import { Button } from './Button';
import { SelectionIndicator } from './Motion';
import './SegmentedControl.css';

export type SegmentOption<T extends string> = { value: T; label: ReactNode; ariaLabel?: string };

/// A short exclusive choice shown in full, with the shared selection marker sliding between options.
/// Arrow keys, Home, and End move the choice the way a radio group does.
export function SegmentedControl<T extends string>({ label, value, options, onChange, className = '', disabled = false }: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = options.length - 1;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : null;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    const group = event.currentTarget.parentElement;
    requestAnimationFrame(() => group?.querySelectorAll<HTMLButtonElement>('[data-selection-key]')[next]?.focus());
  }

  return (
    <SelectionIndicator
      active={value}
      className={`segmented ${className}`.trim()}
      role="group"
      ariaLabel={label}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => (
        <Button
          key={option.value}
          variant="tertiary"
          data-selection-key={option.value}
          className={option.value === value ? 'is-selected' : undefined}
          aria-pressed={option.value === value}
          aria-label={option.ariaLabel}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={event => move(event, index)}
        >
          {option.label}
        </Button>
      ))}
    </SelectionIndicator>
  );
}
