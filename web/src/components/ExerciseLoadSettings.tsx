import { useContext, useEffect, useRef, useState } from 'react';
import type { Unit } from '../types';
import { api, ApiError } from '../lib/api';
import { describeLoad, describeSource, type ExerciseLoadSettings as Settings, type LoadRule } from '../lib/exerciseLoads';
import { GymAvailabilityContext } from '../lib/gymAvailability';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { SettingRow } from './ui/SettingRow';
import { LoadRuleEditor } from './LoadRuleEditor';
import './ExerciseLoadSettings.css';

/// A compact summary in exercise details, or the focused editor inside a workout's weight dialog.
export function ExerciseLoadSettings({ exerciseId, exerciseName, unit, perSide = false, editor = false, onClose, onChanged }: {
  exerciseId: string;
  exerciseName: string;
  unit: Unit;
  perSide?: boolean;
  editor?: boolean;
  onClose?: () => void;
  onChanged?: (settings: Settings) => void | Promise<void>;
}) {
  const { gym } = useContext(GymAvailabilityContext);
  const gymId = gym?.active.id;
  const latest = useRef({ exerciseId, unit, onChanged });
  latest.current = { exerciseId, unit, onChanged };
  // Steps are resolved for one unit; settings read for another unit are not shown under this one.
  const [loaded, setLoaded] = useState<{ unit: Unit; gymId?: string; settings: Settings } | null>(null);
  const settings = loaded?.unit === unit && loaded.gymId === gymId ? loaded.settings : null;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const editTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null);
    setError('');
    api.exerciseLoadSettings(exerciseId, unit, controller.signal).then(next => { if (!controller.signal.aborted) setLoaded({ unit, gymId, settings: next }); }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load weight settings.');
    });
    return () => controller.abort();
  }, [exerciseId, reload, unit, gymId]);

  useEffect(() => { setEditing(false); }, [unit, exerciseId, gymId]);
  useEffect(() => {
    if (editing || busy || !editTrigger.current) return;
    editTrigger.current.focus();
    editTrigger.current = null;
  }, [editing, busy]);

  function close() {
    if (editor) onClose?.();
    else setEditing(false);
  }

  async function save(rule: LoadRule) {
    if (!settings || busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await api.saveExerciseLoadSettings(exerciseId, {
        ...rule, revision: settings.revision, unit, gymProfileId: settings.gymProfileId
      });
      setLoaded({ unit, gymId, settings: saved });
      if (latest.current.exerciseId === exerciseId && latest.current.unit === unit) {
        await latest.current.onChanged?.(saved);
      }
      setEditing(false);
      if (editor) onClose?.();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save weight settings. Please retry.');
    } finally { setBusy(false); }
  }

  const gymName = settings?.gymProfileId
    ? gym?.profiles.find(profile => profile.id === settings.gymProfileId)?.name ?? 'your active gym'
    : gym?.active.name ?? 'your active gym';
  const inherited = settings?.inherited;
  const group = inherited?.equipmentGroup ?? null;
  const failure = error && <div className="error-banner" role="alert">{error} <Button variant="secondary" disabled={busy}
    onClick={() => setReload(current => current + 1)}>Reload settings</Button></div>;
  const weightEditor = <>
    {failure}
    {!settings && !error && <p className="muted" role="status">Loading weight settings…</p>}
    {settings && <p className="muted">Weight settings for {gymName}.</p>}
    {settings && <LoadRuleEditor key={`${unit}-${settings.gymProfileId}-${settings.revision}`} unit={unit} name="exercise-load" busy={busy} perSide={perSide}
      rule={{ loadStepKg: settings.ownStepKg ?? null, availableLoadsKg: settings.ownAvailableLoadsKg ?? null }}
      inheritedStepKg={inherited?.stepKg} inheritedLoadsKg={inherited?.availableLoadsKg}
      inheritText={inherited
        ? `${describeSource(inherited.source, group)}: ${describeLoad(inherited.stepKg, inherited.availableLoadsKg, unit)}.`
        : undefined}
      onSubmit={rule => void save(rule)} onCancel={close} />}
  </>;

  if (editor) return weightEditor;
  return <section className="exercise-load-settings" aria-label="Exercise weight settings">
    {!editing && failure}
    {/* The description line holds "Loading…" until the rule arrives, so the row keeps its height
        and nothing under it moves. */}
    <SettingRow label={<strong>Weight settings</strong>}
      description={settings ? `${describeLoad(settings.loadStepKg, settings.availableLoadsKg, unit)} · ${describeSource(settings.source, group)} · ${gymName}`
        : error ? undefined : 'Loading…'}>
      <Button variant="secondary" disabled={busy || !settings} onClick={event => {
        editTrigger.current = event.currentTarget;
        setEditing(true);
      }}>Edit weights</Button>
    </SettingRow>
    {editing && <Modal title={`${exerciseName} weights`} onClose={close}>
      <div className="modal-body">{weightEditor}</div>
    </Modal>}
  </section>;
}
