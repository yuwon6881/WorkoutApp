import { useRef, useState } from 'react';
import type { Unit } from '../types';
import { displayLoadSetting, loadSettingToKg, type LoadRule } from '../lib/exerciseLoads';
import { validateExerciseLoads } from '../lib/validation';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { AvailableWeightPicker } from './AvailableWeightPicker';
import './LoadRuleEditor.css';

type Mode = 'increment' | 'weights' | 'reps';

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
  const [advanced, setAdvanced] = useState(mode !== 'increment');
  const [fieldError, setFieldError] = useState('');
  const stepField = useRef<HTMLInputElement>(null);
  const presets = unit === 'kg' ? [0.5, 1, 1.25, 2, 2.5, 5, 10, 20, 50] : [1, 2.5, 5, 10, 15, 20, 25, 50, 100, 110];
  function move(direction: 1 | -1) {
    const current = Number(step);
    const next = direction === 1 ? presets.find(value => value > current + 1e-8) : [...presets].reverse().find(value => value < current - 1e-8);
    if (next !== undefined) setStep(String(next));
    setFieldError('');
  }
  function submit() {
    const raw = mode === 'weights' ? weights.join(', ') : mode === 'reps' ? '0' : step;
    const values = mode === 'weights' ? weights : [mode === 'reps' ? 0 : step === initialStep && effectiveStep != null ? effectiveStep : loadSettingToKg(Number(step), unit)];
    const invalid = validateExerciseLoads(raw, values, mode === 'weights');
    if (invalid) { setFieldError(invalid); if (mode === 'increment') stepField.current?.focus(); return; }
    onSubmit(mode === 'weights' ? { loadStepKg: null, availableLoadsKg: values } : { loadStepKg: values[0], availableLoadsKg: null });
  }
  return <form className="load-rule-editor" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
    {!hasOwnRule && inheritText && <p>{inheritText}</p>}
    {mode === 'increment' && <>
      <div className="load-stepper">
        <Button aria-label="Decrease increment" disabled={busy || Number(step) <= presets[0]} onClick={() => move(-1)}>−</Button>
        <Field ref={stepField} name={`${name}-increment`} label={`Weight increase (${unit})`} type="number" min="0" step="any" inputMode="decimal"
          value={step} error={fieldError} disabled={busy} onChange={event => { setStep(event.target.value); setFieldError(''); }} />
        <Button aria-label="Increase increment" disabled={busy || Number(step) >= presets[presets.length - 1]} onClick={() => move(1)}>+</Button>
      </div>
      <p>Total weight added in one step.{perSide && Number(step) > 0 ? ` ${Number((Number(step) / 2).toFixed(3))} ${unit} per side.` : ''}</p>
    </>}
    <Button variant="tertiary" className="load-rule-advanced" disabled={busy} aria-expanded={advanced}
      onClick={() => setAdvanced(!advanced)}>{advanced ? 'Hide advanced options' : 'Advanced options'}</Button>
    {advanced && <div className="load-rule-choices">
      <Button aria-pressed={mode === 'increment'} disabled={busy} onClick={() => { setMode('increment'); setFieldError(''); }}>Weight increase</Button>
      <Button aria-pressed={mode === 'reps'} disabled={busy} onClick={() => { setMode('reps'); setFieldError(''); }}>Reps only</Button>
      <Button aria-pressed={mode === 'weights'} disabled={busy} onClick={() => { setMode('weights'); setFieldError(''); }}>Available weights</Button>
    </div>}
    {mode === 'reps' && <p>Keep the same weight and progress by reps.</p>}
    {mode === 'weights' && <AvailableWeightPicker unit={unit} initial={weights} busy={busy} onChange={next => { setWeights(next); setFieldError(''); }} />}
    {mode === 'weights' && fieldError && <p role="alert">{fieldError}</p>}
    <div className="modal-actions">
      {hasOwnRule && <Button variant="tertiary" disabled={busy} className="load-rule-reset" onClick={() => onSubmit({ loadStepKg: null, availableLoadsKg: null })}>Use default</Button>}
      <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save weights'}</Button>
    </div>
  </form>;
}
