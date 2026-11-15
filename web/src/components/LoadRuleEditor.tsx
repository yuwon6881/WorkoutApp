import { useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { Unit } from '../types';
import { displayLoadSetting, loadSettingToKg, type LoadRule } from '../lib/exerciseLoads';
import { validateExerciseLoads } from '../lib/validation';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { SegmentedControl, type SegmentOption } from './ui/SegmentedControl';
import { AvailableWeightPicker } from './AvailableWeightPicker';
import './LoadRuleEditor.css';

type Mode = 'increment' | 'weights' | 'reps';

const MODES: readonly SegmentOption<Mode>[] = [
  { value: 'increment', label: 'Fixed step' },
  { value: 'weights', label: 'Set weights' },
  { value: 'reps', label: 'Reps only' }
];

export function LoadRuleEditor({ unit, rule, name, inheritText, inheritedStepKg, inheritedLoadsKg, perSide = false, busy, onSubmit, onCancel }: {
  unit: Unit; rule: LoadRule; name: string; inheritText?: string; inheritedStepKg?: number | null; inheritedLoadsKg?: number[] | null; perSide?: boolean;
  busy: boolean; onSubmit: (rule: LoadRule) => void; onCancel: () => void;
}) {
  const hasOwnRule = rule.loadStepKg !== null || rule.availableLoadsKg !== null;
  const effectiveLoads = hasOwnRule ? rule.availableLoadsKg : inheritedLoadsKg;
  const effectiveStep = hasOwnRule ? rule.loadStepKg : inheritedStepKg;
  const [mode, setMode] = useState<Mode>(() => effectiveLoads ? 'weights' : effectiveStep === 0 ? 'reps' : 'increment');
  const initialStep = effectiveStep == null ? '' : displayLoadSetting(effectiveStep, unit);
  const [step, setStep] = useState(initialStep && initialStep !== '0' ? initialStep : unit === 'kg' ? '2.5' : '5');
  const [weights, setWeights] = useState<number[]>(effectiveLoads ?? []);
  const [fieldError, setFieldError] = useState('');
  const stepField = useRef<HTMLInputElement>(null);
  const presets = unit === 'kg' ? [0.5, 1, 1.25, 2, 2.5, 5, 10, 20, 50] : [1, 2.5, 5, 10, 15, 20, 25, 50, 100, 110];
  function move(direction: 1 | -1) {
    const current = Number(step);
    const next = direction === 1 ? presets.find(value => value > current + 1e-8) : [...presets].reverse().find(value => value < current - 1e-8);
    if (next !== undefined) setStep(String(next));
    setFieldError('');
  }
  function choose(next: Mode) {
    setMode(next);
    setFieldError('');
  }
  function submit() {
    const raw = mode === 'weights' ? weights.join(', ') : mode === 'reps' ? '0' : step;
    const values = mode === 'weights' ? weights : [mode === 'reps' ? 0 : step === initialStep && effectiveStep != null ? effectiveStep : loadSettingToKg(Number(step), unit)];
    const invalid = validateExerciseLoads(raw, values, mode === 'weights');
    if (invalid) { setFieldError(invalid); if (mode === 'increment') stepField.current?.focus(); return; }
    onSubmit(mode === 'weights' ? { loadStepKg: null, availableLoadsKg: values } : { loadStepKg: values[0], availableLoadsKg: null });
  }
  const perSideText = perSide && Number(step) > 0 ? ` ${Number((Number(step) / 2).toFixed(3))}\u00a0${unit} per side.` : '';
  return <form className="load-rule-editor" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
    {!hasOwnRule && inheritText && <p className="load-rule-source">{inheritText}</p>}
    <div className="load-rule-mode">
      <span className="load-rule-heading" aria-hidden="true">How weight goes up</span>
      <SegmentedControl<Mode> className="load-rule-modes" label="How weight goes up" value={mode} options={MODES} disabled={busy} onChange={choose} />
    </div>
    {mode === 'increment' && <div className="load-rule-body">
      <div className="load-stepper">
        <Button className="load-stepper-minus" aria-label="Decrease increment" disabled={busy || Number(step) <= presets[0]} onClick={() => move(-1)}>
          <Minus size={16} aria-hidden="true" />
        </Button>
        <Field ref={stepField} className="load-stepper-field" name={`${name}-increment`} label={`Weight increase (${unit})`} type="number" min="0" step="any" inputMode="decimal"
          value={step} error={fieldError} disabled={busy} onChange={event => { setStep(event.target.value); setFieldError(''); }} />
        <Button className="load-stepper-plus" aria-label="Increase increment" disabled={busy || Number(step) >= presets[presets.length - 1]} onClick={() => move(1)}>
          <Plus size={16} aria-hidden="true" />
        </Button>
        <p className="load-stepper-hint">Total weight added in one step.{perSideText}</p>
      </div>
    </div>}
    {mode === 'weights' && <div className="load-rule-body">
      <AvailableWeightPicker unit={unit} initial={weights} busy={busy} onChange={next => { setWeights(next); setFieldError(''); }} />
      {fieldError ? <p className="load-rule-error" role="alert">{fieldError}</p> : <p>Suggested weights come only from this list.</p>}
    </div>}
    {mode === 'reps' && <div className="load-rule-body"><p>Keep the same weight and progress by reps.</p></div>}
    <div className="modal-actions load-rule-actions">
      {hasOwnRule && <Button variant="tertiary" disabled={busy} className="load-rule-reset" onClick={() => onSubmit({ loadStepKg: null, availableLoadsKg: null })}>Use default</Button>}
      <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save weights'}</Button>
    </div>
  </form>;
}
