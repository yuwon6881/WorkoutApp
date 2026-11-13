import { useEffect, useRef, useState } from 'react';
import { formatTypedNumber, parseTypedNumber } from '../lib/numberInput';
import { WorkoutLoadKeypad } from './WorkoutLoadKeypad';

const LOAD_DECIMALS = 3;

/// Whether the main pointer is a finger. Only the way a number is typed follows it (the keypad
/// sheet instead of the system keyboard); the layout never does.
const touchPointer = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: coarse)').matches;

export type LoadKeypadOptions = {
  label: string;
  unit: string;
  stepLabel: string | null;
  /** The next allowed load from the one shown, in the display unit. */
  stepFrom: (from: number | null, direction: 1 | -1) => number | null;
};

/// The load cell of a set row. On a touch screen a tap opens the weight keypad
/// (WorkoutLoadKeypad.tsx), the twin of the reps keypad, with the exercise's weight steps beside
/// the number. With a mouse and keyboard it stays a text field with a decimal keypad rather than a
/// number input: Android keyboards in many locales offer only a comma, which a number input reads
/// as no value at all, and a half-typed "62." must not be saved or overwritten mid-keystroke. A tap
/// selects the prefilled load so a few digits replace it, and Done closes the keyboard.
export function WorkoutLoadInput({
  name,
  ariaLabel,
  value,
  disabled,
  onChange,
  onStep,
  keypad
}: {
  name: string;
  ariaLabel: string;
  /** The load in the display unit, or null when unknown. */
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
  /** Arrow keys move to the next load the exercise allows. */
  onStep: (direction: 1 | -1) => void;
  keypad?: LoadKeypadOptions;
}) {
  const [text, setText] = useState(() => formatTypedNumber(value, LOAD_DECIMALS));
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [useKeypad] = useState(() => Boolean(keypad) && touchPointer());
  const input = useRef<HTMLInputElement>(null);
  const typing = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!typing.current) setText(formatTypedNumber(value, LOAD_DECIMALS));
  }, [value]);

  return (
    <>
      <input
        ref={input}
        name={name}
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={value ?? undefined}
        aria-valuemin={0}
        aria-haspopup={useKeypad ? 'dialog' : undefined}
        aria-expanded={useKeypad ? keypadOpen : undefined}
        type="text"
        inputMode={useKeypad ? 'none' : 'decimal'}
        enterKeyHint="done"
        autoComplete="off"
        placeholder="—"
        disabled={disabled}
        value={disabled ? '' : text}
        onClick={() => { if (useKeypad && !disabled) setKeypadOpen(true); }}
        onFocus={event => {
          typing.current = true;
          const field = event.currentTarget;
          requestAnimationFrame(() => { if (document.activeElement === field) field.select(); });
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
      {keypadOpen && keypad && (
        <WorkoutLoadKeypad
          label={keypad.label}
          unit={keypad.unit}
          value={value}
          stepLabel={keypad.stepLabel}
          onStep={keypad.stepFrom}
          onSave={next => { if (next !== latest.current) { latest.current = next; onChange(next); } }}
          onClose={() => {
            setKeypadOpen(false);
            // Leaving the field unfocused keeps the system keyboard from opening behind the sheet.
            input.current?.blur();
          }}
        />
      )}
    </>
  );
}
