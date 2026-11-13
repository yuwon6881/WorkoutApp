import { useEffect, useState } from 'react';
import { Check, Delete, Minus, Plus } from 'lucide-react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { haptic } from '../lib/platform';
import { formatTypedNumber, parseTypedNumber } from '../lib/numberInput';
import './ui/RepsRirControl.css';

const LOAD_DECIMALS = 3;

/// The weight entry sheet on touch screens, the twin of the reps keypad (ui/RepsRirControl.tsx):
/// the same large readout and thumb-sized keys, a decimal point instead of a locale's comma, and
/// the exercise's own weight steps either side of the number so the next plate is one tap. The
/// first digit replaces the prefilled load, as selecting the field's text did. Done saves; closing
/// the sheet any other way leaves the set as it was.
export function WorkoutLoadKeypad({ label, unit, value, stepLabel, onStep, onSave, onClose }: {
  label: string;
  unit: string;
  /** The load in the display unit, or null when unknown. */
  value: number | null;
  /** The step written on the ± keys ("2.5"), or null when the exercise lists its own weights. */
  stepLabel: string | null;
  /** The next allowed load from the one shown, in the display unit. */
  onStep: (from: number | null, direction: 1 | -1) => number | null;
  onSave: (value: number | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(() => formatTypedNumber(value, LOAD_DECIMALS));
  const [replace, setReplace] = useState(true);
  const type = (key: string) => {
    const next = `${replace ? '' : text}${key}`.replace(/^0+(?=\d)/, '');
    const candidate = key === '.' && (replace || text === '') ? '0.' : next;
    const parsed = parseTypedNumber(candidate, { decimals: LOAD_DECIMALS });
    if (!parsed || (parsed.value ?? 0) > 9999) return;
    setText(candidate);
    setReplace(false);
  };
  const backspace = () => { setText(current => current.slice(0, -1)); setReplace(false); };
  const step = (direction: 1 | -1) => {
    const current = parseTypedNumber(text, { decimals: LOAD_DECIMALS })?.value ?? null;
    const next = onStep(current, direction);
    haptic('tick');
    setText(formatTypedNumber(next, LOAD_DECIMALS));
    setReplace(true);
  };
  const save = () => {
    const parsed = parseTypedNumber(text, { decimals: LOAD_DECIMALS });
    haptic('tick');
    onSave(parsed?.value ?? null);
    onClose();
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (/^\d$/.test(event.key)) { event.preventDefault(); type(event.key); }
      else if (event.key === '.' || event.key === ',') { event.preventDefault(); type('.'); }
      else if (event.key === 'Backspace') { event.preventDefault(); backspace(); }
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); step(event.key === 'ArrowUp' ? 1 : -1); }
      else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); save(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  return (
    <Modal title="Weight" onClose={onClose} className="reps-rir-modal load-keypad-modal">
      <div className="modal-body reps-rir-entry">
        <p>{label}</p>
        <div className="load-entry-row">
          <Button variant="secondary" className="load-step-key" aria-label={stepLabel ? `${stepLabel} ${unit} lighter` : 'Next lighter weight'}
            onClick={() => step(-1)}>
            <Minus size={18} aria-hidden="true" />{stepLabel && <span>{stepLabel}</span>}
          </Button>
          <div className="reps-entry-value" aria-live="polite"><strong>{text || '—'}</strong><span>{unit}</span></div>
          <Button variant="secondary" className="load-step-key" aria-label={stepLabel ? `${stepLabel} ${unit} heavier` : 'Next heavier weight'}
            onClick={() => step(1)}>
            <Plus size={18} aria-hidden="true" />{stepLabel && <span>{stepLabel}</span>}
          </Button>
        </div>
        <div className="reps-entry-keypad load-entry-keypad" role="group" aria-label="Numeric keypad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => <Button key={digit} variant="tertiary" className="reps-key"
            onClick={() => type(String(digit))}>{digit}</Button>)}
          <Button variant="tertiary" className="reps-key load-key-point" aria-label="Decimal point" onClick={() => type('.')}>.</Button>
          <Button variant="tertiary" className="reps-key reps-key-zero" onClick={() => type('0')}>0</Button>
          <Button variant="tertiary" className="reps-key reps-keypad-delete" aria-label="Delete last digit" onClick={backspace}><Delete size={22} /></Button>
          <Button variant="tertiary" className="reps-key reps-keypad-clear" onClick={() => { setText(''); setReplace(false); }}>Clear</Button>
          <Button variant="primary" className="reps-key reps-keypad-done" onClick={save}><Check size={20} />Done</Button>
        </div>
      </div>
    </Modal>
  );
}
