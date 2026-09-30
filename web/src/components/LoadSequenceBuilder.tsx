import { useRef, useState } from 'react';
import type { Unit } from '../types';
import { generateLoads, loadSettingToKg } from '../lib/exerciseLoads';
import { validateExerciseLoads } from '../lib/validation';
import { Button } from './ui/Button';
import { Field } from './ui/Field';

type Part = 'first' | 'last' | 'step';

/// Optional helper; manual weight entry stays independent of its fields and errors.
export function LoadSequenceBuilder({ unit, name, busy, onFill }: {
  unit: Unit;
  name: string;
  busy: boolean;
  onFill: (values: number[]) => void;
}) {
  const [values, setValues] = useState({ first: '', last: '', step: '' });
  const [error, setError] = useState<{ field: Part; message: string } | null>(null);
  const fields = useRef<Partial<Record<Part, HTMLInputElement>>>({});

  function invalid(field: Part, message: string) {
    setError({ field, message });
    fields.current[field]?.focus();
  }

  function fill() {
    const first = Number(values.first);
    const last = Number(values.last);
    const step = Number(values.step);
    if (!values.first.trim() || !Number.isFinite(first) || first < 0)
      return invalid('first', 'Enter a first weight of 0 or more.');
    if (!values.last.trim() || !Number.isFinite(last) || last <= first)
      return invalid('last', 'Enter a last weight above the first.');
    if (!values.step.trim() || !Number.isFinite(step) || step <= 0)
      return invalid('step', 'Enter a step above 0.');
    const intervals = (last - first) / step;
    if (Math.abs(intervals - Math.round(intervals)) > 1e-7)
      return invalid('last', 'The last weight must fit the step from the first.');
    const count = Math.round(intervals) + 1;
    if (count > 200) return invalid('step', 'Increase the step to create at most 200 weights.');
    const weights = generateLoads(first, step, count);
    const invalidLoads = validateExerciseLoads(weights.join(', '), weights.map(value => loadSettingToKg(value, unit)), true);
    if (invalidLoads) return invalid('last', invalidLoads);
    onFill(weights);
  }

  const labels: Record<Part, string> = { first: 'First weight', last: 'Last weight', step: 'Step' };
  return <fieldset className="load-rule-generator" disabled={busy}>
    <legend>Create a sequence</legend>
    {(['first', 'last', 'step'] as const).map(part => <Field key={part}
      ref={element => { if (element) fields.current[part] = element; }}
      name={`${name}-${part}`} label={`${labels[part]} (${unit})`}
      type="number" step="any" min="0" inputMode="decimal" value={values[part]}
      error={error?.field === part ? error.message : undefined}
      onChange={event => { setValues(current => ({ ...current, [part]: event.target.value })); setError(null); }} />)}
    <Button variant="secondary" onClick={fill}>Fill list</Button>
  </fieldset>;
}
