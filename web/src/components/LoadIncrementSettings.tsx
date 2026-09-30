import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Unit } from '../types';
import { api, ApiError } from '../lib/api';
import { describeLoad, describeSource, type EquipmentLoad, type LoadRule, type LoadSettingsOverview } from '../lib/exerciseLoads';
import { equipmentGroupInfo } from '../lib/equipmentGroups';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { SettingRow } from './ui/SettingRow';
import { Skeleton } from './ui/Skeleton';
import { LoadRuleEditor } from './LoadRuleEditor';
import './LoadIncrementSettings.css';

type Editing = EquipmentLoad | null;

/// Account-wide equipment rules. Individual rules are edited with the exercise.
export function LoadIncrementSettings({ unit, notify, onChanged }: {
  unit: Unit;
  notify: (message: string) => void;
  onChanged?: () => void | Promise<void>;
}) {
  const [overview, setOverview] = useState<LoadSettingsOverview | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const editingTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (editing || busy || !editingTrigger.current) return;
    // Touch dialogs may lose the native return target when their sheet is unmounted.
    editingTrigger.current.focus();
    editingTrigger.current = null;
  }, [editing, busy]);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api.loadSettings(controller.signal).then(setOverview).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load weight settings.');
    });
    return () => controller.abort();
  }, [reload]);

  async function run(action: () => Promise<LoadSettingsOverview>, done: string) {
    setBusy(true);
    setError('');
    try {
      setOverview(await action());
      setEditing(null);
      notify(done);
      await onChanged?.();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save weight settings. Please retry.');
    } finally { setBusy(false); }
  }

  const saveEquipment = (item: EquipmentLoad, rule: LoadRule) =>
    run(() => api.saveEquipmentLoad(item.group, { ...rule, revision: item.revision }), `${equipmentGroupInfo(item.group).label} weights saved.`);

  if (!overview) return error
    ? <div className="error-banner" role="alert">{error} <Button variant="secondary" onClick={() => setReload(value => value + 1)}>Retry</Button></div>
    : <div className="panel settings-card" role="status" aria-label="Loading weight settings"><Skeleton className="load-settings-skeleton" /></div>;

  // Types with no exercises and no rule of their own would only be noise.
  const groups = overview.equipment.filter(item => item.exerciseCount > 0 || item.source === 'equipment');

  return <>
    {error && <div className="error-banner" role="alert">{error}</div>}

    <article className="panel settings-card load-settings-group" aria-labelledby="load-equipment-title">
      <h3 id="load-equipment-title">Equipment defaults</h3>
      <p className="muted">Used unless an exercise has its own weights. Set individual machine weights from Exercises.</p>
      {groups.map(item => {
        const info = equipmentGroupInfo(item.group);
        return <SettingRow key={item.group} label={<strong>{info.label}</strong>} descriptionId={`load-${item.group}-description`}
          description={`${describeLoad(item.stepKg, item.availableLoadsKg, unit)} · ${describeSource(item.source, item.group)}`}>
          <Button variant="secondary" disabled={busy} aria-label={`Edit ${info.label} weights`} aria-describedby={`load-${item.group}-description`}
            onClick={event => {
              editingTrigger.current = event.currentTarget;
              setEditing(item);
            }}>
            <Pencil size={15} aria-hidden="true" /> Edit
          </Button>
        </SettingRow>;
      })}
    </article>

    {editing && <Modal title={`${equipmentGroupInfo(editing.group).label} weights`} onClose={() => !busy && setEditing(null)}>
      <div className="modal-body">
        <LoadRuleEditor unit={unit} name={`equipment-${editing.group}`} busy={busy}
          rule={{ loadStepKg: editing.ownStepKg, availableLoadsKg: editing.ownAvailableLoadsKg }}
          perSide={equipmentGroupInfo(editing.group).perSide} preferList={equipmentGroupInfo(editing.group).preferList}
          inheritText={`Uses the app default: ${describeLoad(editing.appDefaultStepKg, null, unit)}.`}
          onSubmit={rule => void saveEquipment(editing, rule)} onCancel={() => setEditing(null)} />
      </div>
    </Modal>}
  </>;
}
