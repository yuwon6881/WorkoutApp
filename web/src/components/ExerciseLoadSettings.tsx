import { useEffect, useRef, useState } from 'react';
import type { Unit } from '../types';
import { api, ApiError } from '../lib/api';
import { describeLoad, describeSource, type ExerciseLoadSettings as Settings, type LoadRule } from '../lib/exerciseLoads';
import { equipmentGroupInfo } from '../lib/equipmentGroups';
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
  onChanged?: () => void | Promise<void>;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const editTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSettings(null);
    setError('');
    api.exerciseLoadSettings(exerciseId, controller.signal).then(setSettings).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load weight settings.');
    });
    return () => controller.abort();
  }, [exerciseId, reload]);

  useEffect(() => { setEditing(false); }, [unit, exerciseId]);
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
      setSettings(await api.saveExerciseLoadSettings(exerciseId, { ...rule, revision: settings.revision }));
      await onChanged?.();
      setEditing(false);
      if (editor) onClose?.();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save weight settings. Please retry.');
    } finally { setBusy(false); }
  }

  const inherited = settings?.inherited;
  const group = inherited?.equipmentGroup ?? null;
  const feedback = <>
    {error && <div className="error-banner" role="alert">{error} <Button variant="secondary" disabled={busy}
      onClick={() => setReload(current => current + 1)}>Reload settings</Button></div>}
    {!settings && !error && <p className="muted" role="status">Loading weight settings…</p>}
  </>;
  const weightEditor = <>
    {feedback}
    {settings && <LoadRuleEditor key={unit} unit={unit} name="exercise-load" busy={busy} perSide={perSide}
      rule={{ loadStepKg: settings.ownStepKg ?? null, availableLoadsKg: settings.ownAvailableLoadsKg ?? null }}
      preferList={group ? equipmentGroupInfo(group).preferList : false}
      inheritText={inherited
        ? `${describeSource(inherited.source, group)}: ${describeLoad(inherited.stepKg, inherited.availableLoadsKg, unit)}.`
        : undefined}
      onSubmit={rule => void save(rule)} onCancel={close} />}
  </>;

  if (editor) return weightEditor;
  return <section className="exercise-load-settings" aria-label="Exercise weight settings">
    {!editing && feedback}
    <SettingRow label={<strong>Weight settings</strong>}
      description={settings ? `${describeLoad(settings.loadStepKg, settings.availableLoadsKg, unit)} · ${describeSource(settings.source, group)}` : undefined}>
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
