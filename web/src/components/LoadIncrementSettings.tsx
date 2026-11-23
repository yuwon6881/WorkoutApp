import { useContext, useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Unit } from '../types';
import { api, ApiError } from '../lib/api';
import { describeLoad, describeSource, type EquipmentLoad, type LoadRule, type LoadSettingsOverview } from '../lib/exerciseLoads';
import { equipmentGroupInfo } from '../lib/equipmentGroups';
import { GymAvailabilityContext } from '../lib/gymAvailability';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { SettingRow } from './ui/SettingRow';
import { Skeleton } from './ui/Skeleton';
import { LoadRuleEditor } from './LoadRuleEditor';
import './LoadIncrementSettings.css';

type Editing = EquipmentLoad | null;

/// Equipment rules for the active gym. Individual rules are edited with the exercise.
export function LoadIncrementSettings({ unit, notify, onChanged }: {
  unit: Unit;
  notify: (message: string) => void;
  onChanged?: () => void | Promise<void>;
}) {
  const { gym } = useContext(GymAvailabilityContext);
  // Steps are resolved for one unit, so they are kept and drawn with the unit they were read in
  // until the next unit's read arrives; a pound label never shows a kilogram step.
  const [loaded, setLoaded] = useState<{ unit: Unit; overview: LoadSettingsOverview } | null>(null);
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
    api.loadSettings(unit, controller.signal).then(overview => { if (!controller.signal.aborted) setLoaded({ unit, overview }); }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load weight settings.');
    });
    return () => controller.abort();
  }, [reload, unit]);

  async function run(actionUnit: Unit, action: () => Promise<LoadSettingsOverview>, done: string) {
    setBusy(true);
    setError('');
    try {
      setLoaded({ unit: actionUnit, overview: await action() });
      setEditing(null);
      notify(done);
      await onChanged?.();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save weight settings. Please retry.');
    } finally { setBusy(false); }
  }

  if (!loaded) return error
    ? <div className="error-banner" role="alert">{error} <Button variant="secondary" onClick={() => setReload(value => value + 1)}>Retry</Button></div>
    : <div className="panel settings-card" role="status" aria-label="Loading weight settings"><Skeleton className="load-settings-skeleton" /></div>;

  const { overview, unit: shown } = loaded;
  const gymName = overview.gymProfileId
    ? gym?.profiles.find(profile => profile.id === overview.gymProfileId)?.name ?? 'your active gym'
    : gym?.active.name ?? 'your active gym';
  const saveEquipment = (item: EquipmentLoad, rule: LoadRule) =>
    run(shown, () => api.saveEquipmentLoad(item.group, { ...rule, revision: item.revision, unit: shown, gymProfileId: overview.gymProfileId }), `${equipmentGroupInfo(item.group).label} weights saved.`);

  // Types with no exercises and no rule of their own would only be noise.
  const groups = overview.equipment.filter(item => item.exerciseCount > 0 || item.source === 'equipment');

  return <>
    {error && !editing && <div className="error-banner" role="alert">{error} <Button variant="secondary"
      onClick={() => { setLoaded(null); setReload(value => value + 1); }}>Reload settings</Button></div>}

    <article className="panel settings-card load-settings-group" aria-labelledby="load-equipment-title">
      <h3 id="load-equipment-title">Equipment defaults</h3>
      <p className="muted">Defaults for {gymName}. Set individual exercise weights from Exercises.</p>
      {groups.map(item => {
        const info = equipmentGroupInfo(item.group);
        return <SettingRow key={item.group} label={<strong>{info.label}</strong>} descriptionId={`load-${item.group}-description`}
          description={`${describeLoad(item.stepKg, item.availableLoadsKg, shown)} · ${describeSource(item.source, item.group)}`}>
          <Button variant="secondary" disabled={busy || Boolean(error)} aria-label={`Edit ${info.label} weights`} aria-describedby={`load-${item.group}-description`}
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
        <p className="muted">Weight settings for {gymName}.</p>
        {error && <div className="error-banner" role="alert">{error} <Button variant="secondary" onClick={() => {
          setLoaded(null);
          setEditing(null);
          setReload(value => value + 1);
        }}>Reload settings</Button></div>}
        <LoadRuleEditor unit={shown} name={`equipment-${editing.group}`} busy={busy}
          rule={{ loadStepKg: editing.ownStepKg, availableLoadsKg: editing.ownAvailableLoadsKg }}
          perSide={equipmentGroupInfo(editing.group).perSide} inheritedStepKg={editing.appDefaultStepKg}
          inheritText={`Uses the app default: ${describeLoad(editing.appDefaultStepKg, null, shown)}.`}
          onSubmit={rule => void saveEquipment(editing, rule)} onCancel={() => setEditing(null)} />
      </div>
    </Modal>}
  </>;
}
