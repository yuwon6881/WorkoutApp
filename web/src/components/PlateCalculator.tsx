import { useState } from 'react';
import type { Unit } from '../types';
import { BAR_OPTIONS, platesFor } from '../lib/plates';
import { Modal } from './ui/Modal';
import { SegmentedControl } from './ui/SegmentedControl';

/// What to put on each side of the bar for the load on the set being logged, so nobody does
/// plate arithmetic between sets. Loads the plates cannot make exactly say so.
export function PlateCalculator({ total, unit, onClose }: { total: number | null; unit: Unit; onClose: () => void }) {
  const [bar, setBar] = useState(BAR_OPTIONS[unit][0]);
  const load = total === null ? null : platesFor(total, bar, unit);

  return (
    <Modal title="Plates per side" onClose={onClose}>
      <div className="modal-body plate-calculator">
        <SegmentedControl
          label="Bar weight"
          value={String(bar)}
          options={BAR_OPTIONS[unit].map(weight => ({ value: String(weight), label: `${weight} ${unit} bar` }))}
          onChange={value => setBar(Number(value))}
        />
        {total === null ? (
          <p className="muted">Enter the load for this set to see its plates.</p>
        ) : !load ? (
          <p className="muted">{total} {unit} is lighter than the {bar} {unit} bar.</p>
        ) : (
          <>
            <p className="plate-total"><strong>{total} {unit}</strong> total</p>
            {load.perSide.length ? (
              <ol className="plate-stack" aria-label="Plates on each side, heaviest first">
                {load.perSide.map((plate, index) => <li key={index} className="plate-chip">{plate}</li>)}
              </ol>
            ) : <p className="muted">Just the bar.</p>}
            {load.remainder > 0 && (
              <p className="plate-remainder" role="status">
                Standard plates load {load.loaded} {unit}; {load.remainder} {unit} needs smaller plates.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
