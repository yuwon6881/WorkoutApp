import { useRef, useState } from 'react';
import type { Unit } from '../types';
import { displayLoadSetting, loadSettingToKg } from '../lib/exerciseLoads';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { MultiSelect } from './ui/Select';

type Weight = { label: string; kg: number };

export function AvailableWeightPicker({ unit, initial, busy, onChange }: {
  unit: Unit; initial: number[]; busy: boolean; onChange: (weights: number[]) => void;
}) {
  const [selected, setSelected] = useState<Weight[]>(() => initial.map(kg => ({ label: displayLoadSetting(kg, unit), kg })));
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const interval = unit === 'kg' ? 2.5 : 5;
  const maximum = unit === 'kg' ? 1000 : 2200;
  const labels = new Set(Array.from({ length: Math.floor(maximum / interval) + 1 }, (_, index) => String(index * interval)));
  selected.forEach(weight => labels.add(weight.label));
  const options = [...labels].sort((a, b) => Number(a) - Number(b)).map(value => ({ value, label: `${value} ${unit}` }));

  function update(next: Weight[]) {
    const sorted = [...next].sort((a, b) => a.kg - b.kg);
    setSelected(sorted);
    onChange(sorted.map(weight => weight.kg));
    setError('');
  }
  function select(labels: string[]) {
    if (labels.length > 200) { setError('You can select at most 200 weights.'); return; }
    update(labels.map(label => selected.find(weight => weight.label === label) ?? { label, kg: loadSettingToKg(Number(label), unit) }));
  }
  function addCustom() {
    const value = Number(custom);
    if (!custom.trim() || !Number.isFinite(value) || value < 0 || loadSettingToKg(value, unit) > 1000) {
      setError('Enter a weight between 0 and 1,000 kg (2,200 lb).');
      input.current?.focus();
      return;
    }
    const label = String(value);
    if (!selected.some(weight => weight.label === label)) {
      if (selected.length >= 200) { setError('You can select at most 200 weights.'); return; }
      update([...selected, { label, kg: loadSettingToKg(value, unit) }]);
    }
    setCustom('');
  }
  return <div className="load-weight-picker">
    <span className="load-weight-label">Available weights ({unit})</span>
    <MultiSelect ariaLabel={`Available weights (${unit})`} values={selected.map(weight => weight.label)}
      onChange={select} options={options} disabled={busy} placeholder="Select available weights"
      displayLabel={selected.length > 4 ? `${selected.slice(0, 3).map(weight => weight.label).join(', ')} ${unit} +${selected.length - 3} more` : undefined}
      footer={<div className="load-weight-custom">
        <Field ref={input} name="custom-available-weight" label={`Other weight (${unit})`} type="number" min="0" step="any" inputMode="decimal"
          value={custom} error={error} disabled={busy} onChange={event => { setCustom(event.target.value); setError(''); }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); addCustom(); } }} />
        <Button variant="secondary" disabled={busy} onClick={addCustom}>Add</Button>
      </div>} />
  </div>;
}
