import { useEffect, useRef, useState } from 'react';
import type { Unit } from '../types';
import { api, ApiError } from '../lib/api';
import { displayLoadSetting, formatAvailableLoads, loadSettingToKg, type ExerciseLoadSettings as Settings } from '../lib/exerciseLoads';
import { showWeight } from '../lib/training';
import { validateExerciseLoads } from '../lib/validation';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { SegmentedControl } from './ui/SegmentedControl';
import './ExerciseLoadSettings.css';

type Mode = 'default' | 'increment' | 'weights';

export function ExerciseLoadSettings({ exerciseId, unit, onChanged }: {
  exerciseId: string;
  unit: Unit;
  onChanged?: () => void | Promise<void>;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<Mode>('default');
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [reload, setReload] = useState(0);
  const field = useRef<HTMLInputElement | null>(null);
  const weightsField = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSettings(null);
    setError('');
    setEditing(false);
    api.exerciseLoadSettings(exerciseId, controller.signal).then(setSettings).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load weight settings.');
    });
    return () => controller.abort();
  }, [exerciseId, reload]);

  // An account unit switch changes the display, never the saved equipment values.
  useEffect(() => { setEditing(false); setFieldError(''); }, [unit]);

  function chooseMode(next: Mode) {
    setMode(next);
    setFieldError('');
    setValue(next === 'weights'
      ? formatAvailableLoads(settings?.availableLoadsKg ?? [], unit)
      : displayLoadSetting(settings?.loadStepKg ?? 2.5, unit));
  }

  async function save() {
    if (!settings || busy) return;
    const numbers = mode === 'weights' ? value.trim().split(/[,;\s]+/).filter(Boolean).map(Number) : [Number(value)];
    const unchanged = value === (mode === 'weights' ? formatAvailableLoads(settings.availableLoadsKg ?? [], unit)
      : displayLoadSetting(settings.loadStepKg, unit));
    const kilograms = unchanged
      ? mode === 'weights' ? settings.availableLoadsKg ?? [] : [settings.loadStepKg]
      : numbers.map(number => loadSettingToKg(number, unit));
    const invalid = mode === 'default' ? undefined : validateExerciseLoads(value, kilograms, mode === 'weights');
    if (invalid) {
      setFieldError(invalid);
      (mode === 'weights' ? weightsField.current : field.current)?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.saveExerciseLoadSettings(exerciseId, {
        loadStepKg: mode === 'increment' ? kilograms[0] : null,
        availableLoadsKg: mode === 'weights' ? kilograms : null,
        revision: settings.revision
      });
      setSettings(result);
      setEditing(false);
      await onChanged?.();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save weight settings. Please retry.');
    } finally { setBusy(false); }
  }

  return <section className="exercise-load-settings" aria-label="Exercise weight settings">
    <div className="section-heading">
      <h3>Weight settings</h3>
      {settings && !editing && <Button variant="secondary" disabled={busy} onClick={() => {
        chooseMode(settings.availableLoadsKg ? 'weights' : settings.isCustomized ? 'increment' : 'default');
        setEditing(true);
      }}>Edit weights</Button>}
    </div>
    {error && <div className="error-banner" role="alert">{error} <Button variant="secondary" disabled={busy} onClick={() => setReload(current => current + 1)}>Reload settings</Button></div>}
    {!settings && !error && <p className="muted" role="status">Loading weight settings…</p>}
    {settings && !editing && <p className="muted">
      {settings.availableLoadsKg ? `${formatAvailableLoads(settings.availableLoadsKg, unit)} ${unit}`
        : `${showWeight(settings.loadStepKg, unit)} increment${settings.isCustomized ? '' : ' · Default'}`}
    </p>}
    {settings && editing && <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
      <SegmentedControl<Mode> label="Weight availability" value={mode} onChange={chooseMode} disabled={busy}
        options={[{ value: 'default', label: 'Default' }, { value: 'increment', label: 'Increment' }, { value: 'weights', label: 'Weight list' }]} />
      <p className="muted">Personal settings for this exercise across your programs. Use the weight you log: per dumbbell, or total barbell or machine load. Suggestions use these settings from the next workout or exercise swap.</p>
      {mode === 'default' && <p>Default increment: {showWeight(settings.defaultStepKg, unit)}.</p>}
      {mode === 'increment' && <>
        <Field ref={field} name="exercise-weight-increment" label={`Weight increment (${unit})`} type="number" step="any" min="0"
          value={value} error={fieldError} disabled={busy} onChange={event => { setValue(event.target.value); setFieldError(''); }} />
        <p className="muted">Set 0 for a fixed load with progression through reps.</p>
      </>}
      {mode === 'weights' && <>
        <TextAreaField ref={weightsField} name="exercise-available-weights" label={`Available weights (${unit})`} rows={3}
          value={value} error={fieldError} disabled={busy} placeholder="5, 7.5, 10, 12.5, 17.5"
          onChange={event => { setValue(event.target.value); setFieldError(''); }} />
        <p className="muted">Separate weights with commas or spaces. Enter at least two; weights are sorted and duplicates removed.</p>
      </>}
      <div className="modal-actions">
        <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save weights'}</Button>
      </div>
    </form>}
  </section>;
}
