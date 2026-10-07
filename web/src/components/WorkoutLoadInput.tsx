import { useEffect, useRef, useState } from 'react';
import { formatTypedNumber, parseTypedNumber } from '../lib/numberInput';

const LOAD_DECIMALS = 3;

/// The load cell of a set row. It is a text field with a decimal keypad rather than a number
/// input: Android keyboards in many locales offer only a comma, which a number input reads as no
/// value at all, and a half-typed "62." must not be saved or overwritten mid-keystroke. A tap
/// selects the prefilled load so a few digits replace it, and Done closes the keyboard.
export function WorkoutLoadInput({
  name,
  ariaLabel,
  value,
  disabled,
  onChange,
  onStep
}: {
  name: string;
  ariaLabel: string;
  /** The load in the display unit, or null when unknown. */
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
  /** Arrow keys move to the next load the exercise allows. */
  onStep: (direction: 1 | -1) => void;
}) {
  const [text, setText] = useState(() => formatTypedNumber(value, LOAD_DECIMALS));
  const typing = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!typing.current) setText(formatTypedNumber(value, LOAD_DECIMALS));
  }, [value]);

  return (
    <input
      name={name}
      role="spinbutton"
      aria-label={ariaLabel}
      aria-valuenow={value ?? undefined}
      aria-valuemin={0}
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      placeholder="—"
      disabled={disabled}
      value={disabled ? '' : text}
      onFocus={event => {
        typing.current = true;
        const input = event.currentTarget;
        requestAnimationFrame(() => { if (document.activeElement === input) input.select(); });
      }}
      onBlur={() => {
        typing.current = false;
        setText(formatTypedNumber(latest.current, LOAD_DECIMALS));
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); return; }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        typing.current = false;
        onStep(event.key === 'ArrowUp' ? 1 : -1);
      }}
      onChange={event => {
        // Anything that is not a number being typed (a minus sign, letters) is refused outright.
        const parsed = parseTypedNumber(event.target.value, { decimals: LOAD_DECIMALS });
        if (!parsed) return;
        setText(event.target.value);
        if (!parsed.complete || parsed.value === latest.current) return;
        latest.current = parsed.value;
        onChange(parsed.value);
      }}
    />
  );
}
