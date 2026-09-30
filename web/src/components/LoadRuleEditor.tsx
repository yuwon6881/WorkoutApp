import { useRef, useState, type ReactNode } from 'react';
import type { Unit } from '../types';
import {
  displayLoadSetting, formatAvailableLoads, generateLoads, loadSettingToKg, type LoadRule, type LoadStack
} from '../lib/exerciseLoads';
import { validateExerciseLoads } from '../lib/validation';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { SegmentedControl } from './ui/SegmentedControl';
import { Select } from './ui/Select';
import './LoadRuleEditor.css';

type Mode = 'inherit' | 'increment' | 'weights' | 'stack';
type Entry = 'total' | 'side';

const modeLabels: Record<Mode, string> = { inherit: 'Default', increment: 'Increment', weights: 'Weight list', stack: 'Weight stack' };

function initialMode(rule: LoadRule, allowInherit: boolean, preferList: boolean): Mode {
  if (rule.stackId) return 'stack';
  if (rule.availableLoadsKg) return 'weights';
  if (rule.loadStepKg !== null) return 'increment';
  return allowInherit ? 'inherit' : preferList ? 'weights' : 'increment';
}

/// Edits one load rule: inherit, a fixed step (entered as a total or per side), a list of the
/// weights that exist (typed or filled from a start, step and count), or a shared stack.
/// Values are entered in the lifter's unit and saved in kilograms at full precision.
export function LoadRuleEditor({
  unit, rule, name, inheritText, allowInherit = true, stacks, perSide = false, preferList = false,
  allowZeroStep = true, busy, submitLabel = 'Save weights', children, validateExtra, onSubmit, onCancel
}: {
  unit: Unit;
  rule: LoadRule;
  name: string;
  inheritText?: string;
  allowInherit?: boolean;
  stacks?: LoadStack[];
  perSide?: boolean;
  preferList?: boolean;
  allowZeroStep?: boolean;
  busy: boolean;
  submitLabel?: string;
  children?: ReactNode;
  validateExtra?: () => boolean;
  onSubmit: (rule: LoadRule) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>(() => initialMode(rule, allowInherit, preferList));
  const [entry, setEntry] = useState<Entry>('total');
  const initialStep = rule.loadStepKg === null ? '' : displayLoadSetting(rule.loadStepKg, unit);
  const initialList = rule.availableLoadsKg ? formatAvailableLoads(rule.availableLoadsKg, unit) : '';
  const [step, setStep] = useState(initialStep);
  const [list, setList] = useState(initialList);
  const [stackId, setStackId] = useState(rule.stackId ?? stacks?.[0]?.id ?? '');
  const [generator, setGenerator] = useState({ start: '', step: '', count: '' });
  const [fieldError, setFieldError] = useState('');
  const stepField = useRef<HTMLInputElement | null>(null);
  const listField = useRef<HTMLTextAreaElement | null>(null);

  const modes: Mode[] = [
    ...(allowInherit ? ['inherit' as const] : []),
    'increment', 'weights',
    ...(stacks?.length ? ['stack' as const] : [])
  ];

  function fillList() {
    const values = generateLoads(Number(generator.start), Number(generator.step), Number(generator.count));
    if (!values.length) { setFieldError('Enter a start weight, a step above 0 and a count of 1 to 200.'); return; }
    setList(values.map(value => String(value)).join(', '));
    setFieldError('');
  }

  function submit() {
    if (validateExtra && !validateExtra()) return;
    if (mode === 'inherit') { onSubmit({ loadStepKg: null, availableLoadsKg: null, stackId: null }); return; }
    if (mode === 'stack') { onSubmit({ loadStepKg: null, availableLoadsKg: null, stackId: stackId || null }); return; }
    const weights = mode === 'weights';
    const raw = weights ? list : step;
    const unchanged = entry === 'total' && raw === (weights ? initialList : initialStep) && raw !== '';
    const factor = !weights && entry === 'side' ? 2 : 1;
    const kilograms = unchanged
      ? weights ? rule.availableLoadsKg ?? [] : [rule.loadStepKg ?? 0]
      : raw.trim().split(/[,;\s]+/).filter(Boolean).map(value => loadSettingToKg(Number(value), unit) * factor);
    const invalid = validateExerciseLoads(raw, kilograms, weights)
      ?? (!weights && !allowZeroStep && kilograms[0] <= 0 ? 'Enter an increment above 0.' : undefined);
    if (invalid) {
      setFieldError(invalid);
      (weights ? listField.current : stepField.current)?.focus();
      return;
    }
    onSubmit(weights
      ? { loadStepKg: null, availableLoadsKg: kilograms, stackId: null }
      : { loadStepKg: kilograms[0], availableLoadsKg: null, stackId: null });
  }

  const chooseMode = (next: Mode) => { setMode(next); setFieldError(''); };

  return <form className="load-rule-editor" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
    {children}
    {modes.length > 3
      ? <Select<Mode> label="Weight rule" name={`${name}-mode`} value={mode} disabled={busy} onChange={chooseMode}
          options={modes.map(value => ({ value, label: modeLabels[value] }))} />
      : <SegmentedControl<Mode> label="Weight rule" value={mode} disabled={busy} onChange={chooseMode}
          options={modes.map(value => ({ value, label: modeLabels[value] }))} />}

    {mode === 'inherit' && <p className="muted">{inheritText ?? 'Uses the default.'}</p>}

    {mode === 'increment' && <>
      {perSide && <SegmentedControl<Entry> label="Enter the increment as" value={entry} disabled={busy}
        onChange={next => { setEntry(next); setFieldError(''); }}
        options={[{ value: 'total', label: 'Total' }, { value: 'side', label: 'Per side' }]} />}
      <Field ref={stepField} name={`${name}-increment`} type="number" step="any" min="0" inputMode="decimal"
        label={entry === 'side' ? `Smallest plate per side (${unit})` : `Weight increment (${unit})`}
        value={step} error={fieldError} disabled={busy} onChange={event => { setStep(event.target.value); setFieldError(''); }} />
      <p className="muted">{entry === 'side'
        ? 'Saved as the total change: 1.25 per side is a 2.5 step.'
        : allowZeroStep ? 'Set 0 for a fixed load with progression through reps.' : 'The smallest change you can make.'}</p>
    </>}

    {mode === 'weights' && <>
      <TextAreaField ref={listField} name={`${name}-weights`} label={`Available weights (${unit})`} rows={3}
        value={list} error={fieldError} disabled={busy} placeholder="2.5, 5, 7.5, 10, 15, 20"
        onChange={event => { setList(event.target.value); setFieldError(''); }} />
      <fieldset className="load-rule-generator" disabled={busy}>
        <legend>Fill evenly</legend>
        <Field name={`${name}-start`} label={`Start (${unit})`} type="number" step="any" min="0" inputMode="decimal"
          value={generator.start} onChange={event => setGenerator(current => ({ ...current, start: event.target.value }))} />
        <Field name={`${name}-step`} label={`Step (${unit})`} type="number" step="any" min="0" inputMode="decimal"
          value={generator.step} onChange={event => setGenerator(current => ({ ...current, step: event.target.value }))} />
        <Field name={`${name}-count`} label="Count" type="number" step="1" min="1" max="200" inputMode="numeric"
          value={generator.count} onChange={event => setGenerator(current => ({ ...current, count: event.target.value }))} />
        <Button variant="secondary" onClick={fillList}>Fill list</Button>
      </fieldset>
      <p className="muted">Separate weights with commas or spaces, or fill them evenly and then edit any that differ.</p>
    </>}

    {mode === 'stack' && stacks && <Select<string> label="Weight stack" name={`${name}-stack`} value={stackId} disabled={busy}
      onChange={setStackId} options={stacks.map(stack => ({ value: stack.id, label: stack.name }))} />}

    <div className="modal-actions">
      <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
    </div>
  </form>;
}
