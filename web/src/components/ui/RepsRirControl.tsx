import { useEffect, useRef, useState } from 'react';
import { Check, Delete, Flame } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';
import { getRirColorClass, RirChips } from './RpeControl';
import './RepsRirControl.css';

type Entry = { text: string; rir: number | null; replace: boolean };

export function RepsRirControl({ name, label, reps, rir, trackRir, onChange }: {
  name: string;
  label: string;
  reps: number | null;
  rir: number | null;
  trackRir: boolean;
  onChange: (reps: number | null, rir: number | null) => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  const open = () => setEntry({ text: reps === null ? '' : String(reps), rir, replace: true });
  const close = () => { restoreFocus.current = true; setEntry(null); };
  const digit = (value: string) => setEntry(current => {
    if (!current) return current;
    const text = `${current.replace ? '' : current.text}${value}`.replace(/^0+(?=\d)/, '');
    return Number(text) <= 1000 ? { ...current, text, replace: false } : current;
  });
  const backspace = () => setEntry(current => current ? { ...current, text: current.text.slice(0, -1), replace: false } : current);
  const save = () => {
    if (!entry) return;
    onChange(entry.text === '' ? null : Number(entry.text), entry.rir);
    close();
  };

  const selectRir = (value: number | null) => {
    if (!entry) return;
    const finalReps = entry.text === '' ? null : Number(entry.text);
    onChange(finalReps, value);
    close();
  };

  useEffect(() => {
    // The nested native dialog must release its focus lock before the input can receive focus.
    if (!entry && restoreFocus.current) {
      restoreFocus.current = false;
      input.current?.focus();
    }
  }, [entry]);

  useEffect(() => {
    if (!entry) return;
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (/^\d$/.test(event.key)) { event.preventDefault(); digit(event.key); }
      else if (event.key === 'Backspace') { event.preventDefault(); backspace(); }
      else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault(); save();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [entry]);

  return <div className="set-input-cell reps-cell combined-reps-cell">
    <input ref={input} name={name} aria-label={`${label} reps`} type="number" inputMode="none"
      placeholder="—" value={reps ?? ''} aria-haspopup="dialog" aria-expanded={!!entry}
      aria-valuetext={trackRir ? `${reps ?? 'No reps'} reps, ${rir === null ? 'RIR unset' : `${rir >= 5 ? '5+' : rir} RIR`}` : undefined}
      onClick={open} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      }}
      onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value), rir)} />
    {trackRir && <span className={`reps-rir-badge ${getRirColorClass(rir)}`} aria-hidden="true">
      {rir === null ? <Flame size={12} className="reps-rir-flame" aria-hidden="true" /> : rir >= 5 ? '5+' : Math.round(rir)}
    </span>}
    {entry && <Modal title={trackRir ? 'Reps & RIR' : 'Reps'} onClose={close} className="reps-rir-modal">
      <div className="modal-body reps-rir-entry">
        <p>{label}</p>
        <div className="reps-entry-value" aria-live="polite"><strong>{entry.text || '—'}</strong><span>reps</span></div>
        {trackRir && <div className="reps-entry-effort">
          <span className="muted">Reps in reserve</span>
          <div className="reps-entry-effort-rail"><RirChips value={entry.rir} ariaLabel={`${label} RIR`}
            onChange={selectRir} /></div>
        </div>}
        <div className="reps-entry-keypad" role="group" aria-label="Numeric keypad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(value => <Button key={value} variant="tertiary"
            onClick={() => digit(String(value))}>{value}</Button>)}
          <Button variant="tertiary" className="reps-keypad-clear" onClick={() => setEntry(current => current ? { ...current, text: '' } : current)}>Clear</Button>
          <Button variant="tertiary" onClick={() => digit('0')}>0</Button>
          <Button variant="tertiary" className="reps-keypad-delete" aria-label="Delete last rep digit" onClick={backspace}><Delete size={21} /></Button>
        </div>
        <Button variant="primary" className="full-width" onClick={save}><Check size={19} />Done</Button>
      </div>
    </Modal>}
  </div>;
}
