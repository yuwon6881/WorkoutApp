import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from './Button';
import { formatTypedNumber, parseTypedNumber, stepValue } from '../../lib/numberInput';
import { haptic } from '../../lib/platform';
import './NumberStepper.css';

const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 90;

/// A number the lifter adjusts with a thumb: − and + move by a step (hold to repeat) and the value
/// itself can still be typed. The text follows the value except while it is being typed, so a
/// half-typed "62," is never overwritten mid-keystroke.
export function NumberStepper({
  value,
  onChange,
  step,
  min = 0,
  max,
  decimals,
  ariaLabel,
  name,
  unit,
  disabled = false,
  placeholder = '—',
  className = ''
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  step: number;
  min?: number;
  max?: number;
  decimals: number;
  ariaLabel: string;
  name?: string;
  unit?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(() => formatTypedNumber(value, decimals));
  const typing = useRef(false);
  const repeat = useRef<{ delay?: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setInterval> }>({});
  // A held button has already stepped; the click that ends the hold must not step once more.
  const repeated = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!typing.current) setText(formatTypedNumber(value, decimals));
  }, [value, decimals]);

  useEffect(() => () => stopRepeat(), []);

  function clamp(next: number) {
    return max === undefined ? next : Math.min(max, next);
  }

  function nudge(direction: 1 | -1) {
    const next = clamp(stepValue(latest.current, step, direction, min));
    if (next === latest.current) return;
    latest.current = next;
    typing.current = false;
    setText(formatTypedNumber(next, decimals));
    onChange(next);
    haptic('tick');
  }

  function clickStep(direction: 1 | -1) {
    if (repeated.current) { repeated.current = false; return; }
    nudge(direction);
  }

  function startRepeat(direction: 1 | -1, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || disabled) return;
    stopRepeat();
    repeated.current = false;
    repeat.current.delay = setTimeout(() => {
      repeated.current = true;
      nudge(direction);
      repeat.current.every = setInterval(() => nudge(direction), REPEAT_EVERY_MS);
    }, REPEAT_DELAY_MS);
  }

  function stopRepeat() {
    clearTimeout(repeat.current.delay);
    clearInterval(repeat.current.every);
    repeat.current = {};
  }

  const stepLabel = unit ? `${formatTypedNumber(step, 2)} ${unit}` : formatTypedNumber(step, 2);

  return (
    <div className={`number-stepper ${disabled ? 'disabled' : ''} ${className}`.trim()}>
      <Button
        variant="tertiary"
        className="number-stepper-button"
        aria-label={`Decrease ${ariaLabel} by ${stepLabel}`}
        disabled={disabled || (value !== null && value <= min)}
        onClick={() => clickStep(-1)}
        onPointerDown={event => startRepeat(-1, event)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
      >
        <Minus size={18} aria-hidden="true" />
      </Button>
      <input
        name={name}
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={value ?? undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        type="text"
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        enterKeyHint="done"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onFocus={event => {
          typing.current = true;
          // Selecting on focus lets one tap and a few digits replace a prefilled value.
          const input = event.currentTarget;
          requestAnimationFrame(() => input.select());
        }}
        onBlur={() => {
          typing.current = false;
          setText(formatTypedNumber(latest.current, decimals));
        }}
        onChange={event => {
          const parsed = parseTypedNumber(event.target.value, { decimals });
          if (!parsed) return;
          setText(event.target.value);
          const next = parsed.value === null ? null : clamp(parsed.value);
          if (next !== latest.current) {
            latest.current = next;
            onChange(next);
          }
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowUp') { event.preventDefault(); nudge(1); }
          if (event.key === 'ArrowDown') { event.preventDefault(); nudge(-1); }
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <Button
        variant="tertiary"
        className="number-stepper-button"
        aria-label={`Increase ${ariaLabel} by ${stepLabel}`}
        disabled={disabled || (max !== undefined && value !== null && value >= max)}
        onClick={() => clickStep(1)}
        onPointerDown={event => startRepeat(1, event)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
      >
        <Plus size={18} aria-hidden="true" />
      </Button>
    </div>
  );
}
