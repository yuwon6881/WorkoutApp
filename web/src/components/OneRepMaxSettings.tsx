import { useEffect, useRef, useState } from 'react';
import type { Unit } from '../types';
import { api, ApiError } from '../lib/api';
import { describeOneRepMax, oneRepMaxField, parseOneRepMax, showEstimatedMax, type OneRepMaxView } from '../lib/oneRepMax';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import { SettingRow } from './ui/SettingRow';

/// The lifter's one-rep max for a lift. Programs that print a percentage of 1RM turn it into a load
/// when a workout starts; without a typed value the server estimates one from logged sets. The
/// chart's estimated 1RM is a separate, history-only figure that a typed value never changes.
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

  const typed = view?.overrideKg ?? null;
  const estimate = view?.estimatedKg ?? null;

  return <section aria-label="One-rep max">
    {error && <div className="error-banner" role="alert">{error} <Button variant="secondary"
      onClick={() => setReload(current => current + 1)}>Reload</Button></div>}
    <SettingRow label={<strong>One-rep max</strong>} description={view ? describeOneRepMax(view, unit) : error ? undefined : 'Loading…'}>
      <Button variant="secondary" disabled={!view || busy} onClick={event => {
        trigger.current = event.currentTarget;
        // Only a value the lifter typed is put in the field. Prefilling the estimate would turn it
        // into a typed value on Save, and it would stop following their training.
        setText(oneRepMaxField(typed, unit));
        setFieldError('');
        setEditing(true);
      }}>{typed !== null ? 'Edit' : 'Set'}</Button>
    </SettingRow>
    {editing && <Modal title={`${exerciseName} one-rep max`} onClose={() => setEditing(false)}>
      <form className="modal-body" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
        <Field name="one-rep-max" type="number" step="any" min="0" inputMode="decimal" autoFocus
          label={`One-rep max (${unit})`} value={text} error={fieldError} disabled={busy}
          placeholder={estimate !== null ? `Estimate: ${showEstimatedMax(estimate, unit)}` : undefined}
          onChange={event => { setText(event.target.value); setFieldError(''); }} />
        <p className="muted">
          Used only for sets a program prints as a percentage of 1RM, from the next workout you start.
          {estimate !== null
            ? ` Your recent heavy sets suggest about ${showEstimatedMax(estimate, unit)}; leave the field empty to follow that estimate as it changes.`
            : ' Leave the field empty to follow the estimate from your logged sets once there is one.'}
        </p>
        <div className="modal-actions">
          <Button variant="tertiary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          {typed !== null && <Button variant="secondary" disabled={busy} onClick={() => void save(null)}>
            {estimate !== null ? 'Use estimate' : 'Clear'}
          </Button>}
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>}
  </section>;
}
