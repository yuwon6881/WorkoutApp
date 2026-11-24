import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { GymProfile, Unit } from '../types';
import { api, ApiError } from '../lib/api';
import { describeLoad, describeSource, type EquipmentLoad, type LoadRule, type LoadSettingsOverview } from '../lib/exerciseLoads';
import { equipmentGroupInfo } from '../lib/equipmentGroups';
import { Button } from './ui/Button';
import { LiftLoader } from './ui/LiftLoader';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { SettingRow } from './ui/SettingRow';
import { Skeleton } from './ui/Skeleton';
import { LoadRuleEditor } from './LoadRuleEditor';
import './LoadIncrementSettings.css';

type WeightSettingsProps = {
  unit: Unit;
  notify: (message: string) => void;
  onChanged?: () => void | Promise<void>;
};

export function LoadIncrementSettings({ profiles, activeId, onChanged, ...props }: WeightSettingsProps & {
  profiles: GymProfile[];
  activeId: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gym = profiles.find(profile => profile.id === selectedId) ?? profiles.find(profile => profile.id === activeId);
  if (!gym) return null;

  return <article className="panel settings-card load-settings-group" aria-labelledby="load-equipment-title">
    <h3 id="load-equipment-title">Equipment defaults</h3>
    <p className="muted">{profiles.length === 1 && `Defaults for ${gym.name}. `}Set individual exercise weights from Exercises.</p>
    {profiles.length > 1 && <SettingRow label={<strong>Gym</strong>} description="Choose which gym’s weight increments to edit.">
      <Select ariaLabel="Gym for weight increments" value={gym.id}
        options={profiles.map(profile => ({ value: profile.id, label: profile.active ? `${profile.name} (in use)` : profile.name }))}
        onChange={setSelectedId} />
    </SettingRow>}
    <EquipmentLoadRows {...props} gym={gym} onChanged={gym.id === activeId ? onChanged : undefined} />
  </article>;
}

function EquipmentLoadRows({ gym, unit, notify, onChanged }: WeightSettingsProps & { gym: GymProfile }) {
  // Steps are resolved for one unit, so they are kept and drawn with the unit they were read in
  // until the next unit's read arrives; a pound label never shows a kilogram step.
  const [loaded, setLoaded] = useState<{ gymId: string; unit: Unit; overview: LoadSettingsOverview } | null>(null);
  const [editing, setEditing] = useState<EquipmentLoad | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ gymId: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [loadingGymId, setLoadingGymId] = useState<string | null>(null);
  const editingTrigger = useRef<HTMLButtonElement | null>(null);
  const error = failure?.gymId === gym.id ? failure.message : '';
  const switching = Boolean(loaded && loaded.gymId !== gym.id && !error);

  useEffect(() => {
    if (editing || busy || !editingTrigger.current) return;
    // Touch dialogs may lose the native return target when their sheet is unmounted.
    editingTrigger.current.focus();
    editingTrigger.current = null;
  }, [editing, busy]);

  useEffect(() => {
    const controller = new AbortController();
    setFailure(null);
    api.loadSettings(gym.id, unit, controller.signal).then(overview => {
      if (!controller.signal.aborted) setLoaded({ gymId: gym.id, unit, overview });
    }).catch(reason => {
      if (!controller.signal.aborted) setFailure({ gymId: gym.id, message: reason instanceof Error ? reason.message : 'Could not load weight settings.' });
    });
    return () => controller.abort();
  }, [gym.id, reload, unit]);

  useEffect(() => {
    if (!switching) return;
    const timer = setTimeout(() => setLoadingGymId(gym.id), 200);
    return () => {
      clearTimeout(timer);
      setLoadingGymId(null);
    };
  }, [gym.id, switching]);

  async function run(actionUnit: Unit, action: () => Promise<LoadSettingsOverview>, done: string) {
    setBusy(true);
    setFailure(null);
    try {
      setLoaded({ gymId: gym.id, unit: actionUnit, overview: await action() });
      setEditing(null);
      notify(done);
      await onChanged?.();
    } catch (reason) {
      setFailure({ gymId: gym.id, message: reason instanceof ApiError ? reason.message : 'Could not save weight settings. Please retry.' });
    } finally { setBusy(false); }
  }

  if (error && (!loaded || loaded.gymId !== gym.id)) return <div className="error-banner" role="alert">
    {error} <Button variant="secondary" onClick={() => setReload(value => value + 1)}>Retry</Button>
  </div>;
  if (!loaded) return <div role="status" aria-label="Loading weight settings">
    {[0, 1, 2, 3].map(row => <SettingRow key={row} className="load-settings-placeholder"
      label={<span className="skeleton load-settings-label-placeholder" />} description={<span className="skeleton load-settings-value-placeholder" />}>
      <Skeleton className="load-settings-button-placeholder" />
    </SettingRow>)}
  </div>;

  const { overview, unit: shown } = loaded;
  const saveEquipment = (item: EquipmentLoad, rule: LoadRule) =>
    run(shown, () => api.saveEquipmentLoad(gym.id, item.group, { ...rule, revision: item.revision, unit: shown }),
      `${equipmentGroupInfo(item.group).label} weights saved for ${gym.name}.`);

  // Types with no exercises and no rule of their own would only be noise.
  const groups = overview.equipment.filter(item => item.exerciseCount > 0 || item.source === 'equipment');

  return <>
    {error && !editing && <div className="error-banner" role="alert">{error} <Button variant="secondary"
      onClick={() => { setLoaded(null); setReload(value => value + 1); }}>Reload settings</Button></div>}

    <div className="load-settings-rows">
      <div inert={switching} className={loadingGymId === gym.id && switching ? 'load-settings-pending' : undefined}>
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
      </div>
      {switching && loadingGymId === gym.id && <div className="load-settings-status" role="status">
        <LiftLoader size="sm" /> <span>Loading weights for {gym.name}…</span>
      </div>}
    </div>

    {editing && <Modal title={`${equipmentGroupInfo(editing.group).label} weights`} onClose={() => !busy && setEditing(null)}>
      <div className="modal-body">
        <p className="muted">Weight settings for {gym.name}.</p>
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
