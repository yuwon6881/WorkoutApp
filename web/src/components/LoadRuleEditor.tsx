import { useRef, useState } from 'react';
import type { Unit } from '../types';
import {
  displayLoadSetting, formatAvailableLoads, loadSettingToKg, type LoadRule
} from '../lib/exerciseLoads';
import { validateExerciseLoads } from '../lib/validation';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { SegmentedControl } from './ui/SegmentedControl';
import { LoadSequenceBuilder } from './LoadSequenceBuilder';
import './LoadRuleEditor.css';

type Mode = 'increment' | 'weights';
type Entry = 'total' | 'side';

const modeLabels: Record<Mode, string> = { increment: 'Increment', weights: 'Weight list' };

function initialMode(rule: LoadRule, preferList: boolean): Mode {
  if (rule.availableLoadsKg) return 'weights';
  if (rule.loadStepKg !== null) return 'increment';
  return preferList ? 'weights' : 'increment';
}

/// Edits one load rule as one of two choices: a fixed increment (entered as a total or per side) or
/// a list of the weights that exist (typed or filled evenly). "Use default" clears the rule.
/// Values are entered in the lifter's unit and saved in kilograms at full precision.
export function LoadRuleEditor({
  unit, rule, name, inheritText, perSide = false, preferList = false,
  busy, onSubmit, onCancel
}: {
  unit: Unit;
  rule: LoadRule;
  name: string;
  inheritText?: string;
  perSide?: boolean;
  preferList?: boolean;
  busy: boolean;
  onSubmit: (rule: LoadRule) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>(() => initialMode(rule, preferList));
  const [entry, setEntry] = useState<Entry>('total');
  const initialStep = rule.loadStepKg === null ? '' : displayLoadSetting(rule.loadStepKg, unit);
  const initialList = rule.availableLoadsKg ? formatAvailableLoads(rule.availableLoadsKg, unit) : '';
  const [step, setStep] = useState(initialStep);
  const [list, setList] = useState(initialList);
  const [sequenceOpen, setSequenceOpen] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const stepField = useRef<HTMLInputElement | null>(null);
  const listField = useRef<HTMLTextAreaElement | null>(null);

  const modes: Mode[] = ['increment', 'weights'];
  const hasOwnRule = rule.loadStepKg !== null || rule.availableLoadsKg !== null;

  function submit() {
    const weights = mode === 'weights';
    const raw = weights ? list : step;
    const unchanged = entry === 'total' && raw === (weights ? initialList : initialStep) && raw !== '';
    const factor = !weights && entry === 'side' ? 2 : 1;
    const kilograms = unchanged
      ? weights ? rule.availableLoadsKg ?? [] : [rule.loadStepKg ?? 0]
      : raw.trim().split(/[,;\s]+/).filter(Boolean).map(value => loadSettingToKg(Number(value), unit) * factor);
    const invalid = validateExerciseLoads(raw, kilograms, weights);
    if (invalid) {
      setFieldError(invalid);
      (weights ? listField.current : stepField.current)?.focus();
      return;
    }
    onSubmit(weights
      ? { loadStepKg: null, availableLoadsKg: kilograms }
      : { loadStepKg: kilograms[0], availableLoadsKg: null });
  }

  const chooseMode = (next: Mode) => { setMode(next); setFieldError(''); };

  return <form className="load-rule-editor" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
    {!hasOwnRule && inheritText && <p className="muted">{inheritText}</p>}
    <SegmentedControl<Mode> label="Weights change by" value={mode} disabled={busy} onChange={chooseMode}
      options={modes.map(value => ({ value, label: modeLabels[value] }))} />

    {mode === 'increment' && <>
      {perSide && <SegmentedControl<Entry> label="Enter the increment as" value={entry} disabled={busy}
        onChange={next => { setEntry(next); setFieldError(''); }}
        options={[{ value: 'total', label: 'Total' }, { value: 'side', label: 'Per side' }]} />}
      <Field ref={stepField} name={`${name}-increment`} type="number" step="any" min="0" inputMode="decimal"
        label={entry === 'side' ? `Smallest plate per side (${unit})` : `Weight increment (${unit})`}
        value={step} error={fieldError} disabled={busy} onChange={event => { setStep(event.target.value); setFieldError(''); }} />
      <p className="muted">{entry === 'side'
        ? (unit === 'lb' ? '2.5 per side = a 5 total step.' : '1.25 per side = a 2.5 total step.')
        : 'Use 0 to progress through reps only.'}</p>
    </>}

    {mode === 'weights' && <>
      <TextAreaField ref={listField} name={`${name}-weights`} label={`Available weights (${unit})`} rows={2}
        value={list} error={fieldError} disabled={busy}
        placeholder={unit === 'lb' ? '5, 10, 15, 20, 25, 30' : '2.5, 5, 7.5, 10, 15, 20'}
        onChange={event => { setList(event.target.value); setFieldError(''); }} />
      <p className="muted">Enter the weights you use, separated by commas or spaces.</p>
      <Button variant="tertiary" className="load-rule-sequence-toggle" disabled={busy} aria-expanded={sequenceOpen}
        aria-controls={`${name}-sequence`} onClick={() => setSequenceOpen(current => !current)}>
        {sequenceOpen ? 'Hide sequence helper' : 'Create a sequence'}
      </Button>
      {sequenceOpen && <div id={`${name}-sequence`}><LoadSequenceBuilder unit={unit} name={name} busy={busy}
        onFill={values => {
          setList(values.join(', '));
          setFieldError('');
          setSequenceOpen(false);
          listField.current?.focus();
        }} /></div>}
    </>}

    <div className="modal-actions">
      {hasOwnRule && <Button variant="tertiary" disabled={busy} className="load-rule-reset"
        onClick={() => onSubmit({ loadStepKg: null, availableLoadsKg: null })}>Use default</Button>}
      <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save weights'}</Button>
    </div>
  </form>;
}
