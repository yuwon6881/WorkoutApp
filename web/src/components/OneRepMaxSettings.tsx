import { useEffect, useRef, useState } from 'react';
import type { Unit } from '../types';
import { api, ApiError } from '../lib/api';
import { oneRepMaxField, parseOneRepMax, type OneRepMaxView } from '../lib/oneRepMax';
import { showWeight } from '../lib/training';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import { SettingRow } from './ui/SettingRow';

function describe(view: OneRepMaxView, unit: Unit): string {
  if (view.overrideKg !== null) return `${showWeight(view.overrideKg, unit)}, entered by you.`;
  if (view.estimatedKg !== null) return `About ${showWeight(view.estimatedKg, unit)}, estimated from your recent heavy sets.`;
  return 'Not set yet. Enter one so percentage-based sets can show a weight.';
}

/// The lifter's one-rep max for a lift. Programs that print a percentage of 1RM turn it into a load
/// when a workout starts; without a typed value the server estimates one from logged sets.
export function OneRepMaxSettings({ exerciseId, exerciseName, unit }: { exerciseId: string; exerciseName: string; unit: Unit }) {
  const [view, setView] = useState<OneRepMaxView | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setError('');
    api.exerciseOneRepMax(exerciseId, controller.signal).then(setView).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load your one-rep max.');
    });
    return () => controller.abort();
  }, [exerciseId, reload]);

  useEffect(() => {
    if (editing || busy || !trigger.current) return;
    trigger.current.focus();
    trigger.current = null;
  }, [editing, busy]);

  async function save(kg: number | null) {
    setBusy(true);
    setError('');
    try {
      setView(await api.saveExerciseOneRepMax(exerciseId, kg));
      setEditing(false);
    } catch (failure) {
      setFieldError(failure instanceof ApiError ? failure.message : 'Could not save your one-rep max. Please retry.');
    } finally { setBusy(false); }
  }

  function submit() {
    const parsed = parseOneRepMax(text, unit);
    if (parsed.error) { setFieldError(parsed.error); return; }
    void save(parsed.kg);
  }

  return <section aria-label="One-rep max">
    {error && <div className="error-banner" role="alert">{error} <Button variant="secondary"
      onClick={() => setReload(current => current + 1)}>Reload</Button></div>}
    <SettingRow label={<strong>One-rep max</strong>} description={view ? describe(view, unit) : error ? undefined : 'Loading…'}>
      <Button variant="secondary" disabled={!view || busy} onClick={event => {
        trigger.current = event.currentTarget;
        setText(oneRepMaxField(view?.overrideKg ?? view?.estimatedKg ?? null, unit));
        setFieldError('');
        setEditing(true);
      }}>{view?.overrideKg !== null && view?.overrideKg !== undefined ? 'Edit' : 'Set'}</Button>
    </SettingRow>
    {editing && <Modal title={`${exerciseName} one-rep max`} onClose={() => setEditing(false)}>
      <form className="modal-body" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
        <Field name="one-rep-max" type="number" step="any" min="0" inputMode="decimal" autoFocus
          label={`One-rep max (${unit})`} value={text} error={fieldError} disabled={busy}
          onChange={event => { setText(event.target.value); setFieldError(''); }} />
        <p className="muted">Applies from the next workout you start. Leave it empty to go back to the estimate from your logged sets.</p>
        <div className="modal-actions">
          <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>}
  </section>;
}
