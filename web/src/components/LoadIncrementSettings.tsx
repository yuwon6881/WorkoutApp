import { useEffect, useState } from 'react';
import { Pencil, Plus, RotateCcw } from 'lucide-react';
import type { Unit } from '../types';
import { api, ApiError } from '../lib/api';
import { describeLoad, describeSource, type EquipmentLoad, type LoadRule, type LoadSettingsOverview, type LoadStack } from '../lib/exerciseLoads';
import { equipmentGroupInfo } from '../lib/equipmentGroups';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { SettingRow } from './ui/SettingRow';
import { Skeleton } from './ui/Skeleton';
import { LoadRuleEditor } from './LoadRuleEditor';
import { LoadStackDialog } from './LoadStackDialog';
import './LoadIncrementSettings.css';

type Editing = { kind: 'equipment'; item: EquipmentLoad } | { kind: 'stack'; item: LoadStack | null } | null;

/// Account-wide weight rules: one per equipment type, named stacks several exercises can share,
/// and the exercises that keep their own rule. Every change reaches suggestions from the next workout.
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
      <p className="muted">Applies to every exercise of that equipment unless the exercise has its own setting. Machines are not listed because each one has different weights: set them from the exercise's details or during a workout.</p>
      {groups.map(item => {
        const info = equipmentGroupInfo(item.group);
        return <SettingRow key={item.group} label={<strong>{info.label}</strong>} descriptionId={`load-${item.group}-description`}
          description={`${describeLoad(item.stepKg, item.availableLoadsKg, unit)} · ${describeSource(item.source, item.group, item.stackName)} · ${item.exerciseCount} exercises`}>
          <Button variant="secondary" disabled={busy} aria-label={`Edit ${info.label} weights`} aria-describedby={`load-${item.group}-description`}
            onClick={() => setEditing({ kind: 'equipment', item })}>
            <Pencil size={15} aria-hidden="true" /> Edit
          </Button>
        </SettingRow>;
      })}
    </article>

    <article className="panel settings-card load-settings-group" aria-labelledby="load-stacks-title">
      <div className="load-settings-heading">
        <h3 id="load-stacks-title">Weight stacks</h3>
        <Button variant="secondary" disabled={busy} onClick={() => setEditing({ kind: 'stack', item: null })}>
          <Plus size={15} aria-hidden="true" /> Add stack
        </Button>
      </div>
      <p className="muted">Name a machine's weights once, such as “Gym B cable”, then use it for any exercise or equipment type.</p>
      {overview.stacks.length === 0 && <p className="muted load-settings-empty">No weight stacks yet.</p>}
      {overview.stacks.map(stack => <SettingRow key={stack.id} label={<strong>{stack.name}</strong>} descriptionId={`stack-${stack.id}-description`}
        description={`${describeLoad(stack.loadStepKg, stack.availableLoadsKg, unit)} · used by ${stack.exerciseCount} exercises${stack.equipmentGroups.length ? ` and ${stack.equipmentGroups.map(group => equipmentGroupInfo(group).label).join(', ')}` : ''}`}>
        <Button variant="secondary" disabled={busy} aria-label={`Edit ${stack.name}`} onClick={() => setEditing({ kind: 'stack', item: stack })}>
          <Pencil size={15} aria-hidden="true" /> Edit
        </Button>
      </SettingRow>)}
    </article>

    <article className="panel settings-card load-settings-group" aria-labelledby="load-overrides-title">
      <h3 id="load-overrides-title">Exercises with their own weights</h3>
      <p className="muted">Set these from an exercise's details or during a workout.</p>
      {overview.overrides.length === 0 && <p className="muted load-settings-empty">Every exercise follows its equipment default.</p>}
      {overview.overrides.map(item => <SettingRow key={item.exerciseId} label={<strong>{item.name}</strong>}
        description={item.stackName ? `Stack “${item.stackName}”` : describeLoad(item.ownStepKg, item.ownAvailableLoadsKg, unit)}>
        <Button variant="tertiary" disabled={busy} aria-label={`Restore default weights for ${item.name}`}
          onClick={() => void run(async () => {
            await api.saveExerciseLoadSettings(item.exerciseId, { loadStepKg: null, availableLoadsKg: null, stackId: null, revision: item.revision });
            return api.loadSettings();
          }, `${item.name} follows its default again.`)}>
          <RotateCcw size={15} aria-hidden="true" /> Restore default
        </Button>
      </SettingRow>)}
    </article>

    {editing?.kind === 'equipment' && <Modal title={`${equipmentGroupInfo(editing.item.group).label} weights`} onClose={() => !busy && setEditing(null)}>
      <div className="modal-body">
        <p className="muted">{equipmentGroupInfo(editing.item.group).hint}</p>
        <LoadRuleEditor unit={unit} name={`equipment-${editing.item.group}`} busy={busy} stacks={overview.stacks}
          rule={{ loadStepKg: editing.item.ownStepKg, availableLoadsKg: editing.item.ownAvailableLoadsKg, stackId: editing.item.stackId }}
          perSide={equipmentGroupInfo(editing.item.group).perSide} preferList={equipmentGroupInfo(editing.item.group).preferList}
          inheritText={`Uses the app default: ${describeLoad(editing.item.appDefaultStepKg, null, unit)}.`}
          onSubmit={rule => void saveEquipment(editing.item, rule)} onCancel={() => setEditing(null)} />
      </div>
    </Modal>}

    {editing?.kind === 'stack' && <LoadStackDialog unit={unit} stack={editing.item} busy={busy} onClose={() => setEditing(null)}
      onSave={input => void run(() => api.saveLoadStack(editing.item?.id ?? null, { ...input, revision: editing.item?.revision ?? 0 }),
        `Weight stack “${input.name}” saved.`)}
      onDelete={editing.item ? () => {
        const id = editing.item!.id;
        void run(() => api.deleteLoadStack(id), 'Weight stack deleted. Its exercises follow their defaults again.');
      } : undefined} />}
  </>;
}
