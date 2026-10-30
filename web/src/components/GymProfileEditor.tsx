import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Exercise, GymEquipmentGroup, GymEquipmentItem, GymExerciseOverride, GymProfile } from '../types';
import { api } from '../lib/api';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import { Switch } from './ui/Switch';

const NAME_LIMIT = 60;

const GROUPS: { group: GymEquipmentGroup; title: string }[] = [
  { group: 'free-weights', title: 'Free weights' },
  { group: 'benches-racks', title: 'Benches and racks' },
  { group: 'cables', title: 'Cables' },
  { group: 'machines', title: 'Machines' }
];

type Row = { name: string; items: GymEquipmentItem[] };

/** A machine built both ways shares one row with a switch per build. */
function rows(items: GymEquipmentItem[]): Row[] {
  const output: Row[] = [];
  for (const item of items) {
    const name = item.machine ?? item.label;
    const previous = output.at(-1);
    if (item.machine && previous?.name === name) previous.items.push(item);
    else output.push({ name, items: [item] });
  }
  return output;
}

export type GymProfileInput = { name: string; missingEquipment: string[]; exerciseOverrides: Record<string, GymExerciseOverride> };

/// Name, equipment, and hand-set exercises for one gym. Nothing is saved until Save.
export function GymProfileEditor({ profile, equipment, busy, error, onClose, onSave, onDelete }: {
  profile: GymProfile;
  equipment: GymEquipmentItem[];
  busy: boolean;
  /** The last save's failure, shown in the dialog rather than behind it. */
  error: string;
  onClose: () => void;
  onSave: (input: GymProfileInput) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(profile.name);
  const [nameError, setNameError] = useState('');
  const [missing, setMissing] = useState(() => new Set(profile.missingEquipment));
  const [overrides, setOverrides] = useState(profile.exerciseOverrides);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exerciseNames = useExerciseNames(Object.keys(overrides).length > 0);

  const setAvailable = (keys: string[], available: boolean) => setMissing(current => {
    const next = new Set(current);
    for (const key of keys) {
      if (available) next.delete(key);
      else next.add(key);
    }
    return next;
  });

  function save() {
    const trimmed = name.trim();
    if (!trimmed) { setNameError('Name the gym.'); return; }
    if (trimmed.length > NAME_LIMIT) { setNameError(`Use ${NAME_LIMIT} characters or fewer.`); return; }
    void onSave({ name: trimmed, missingEquipment: [...missing].sort(), exerciseOverrides: overrides });
  }

  const overrideEntries = Object.entries(overrides);

  return <Modal title={`Edit ${profile.name}`} wide onClose={onClose}>
    <form className="gym-dialog-form" noValidate onSubmit={event => { event.preventDefault(); save(); }}>
      <div className="modal-body gym-editor">
      {error && <div className="error-banner" role="alert">{error}</div>}
      <Field label="Name" name="gym-name" value={name} maxLength={NAME_LIMIT} autoComplete="off" error={nameError}
        onChange={event => { setName(event.target.value); setNameError(''); }} />
      <p className="muted small-copy">Turn off what this gym does not have. Exercises that need it are flagged wherever they appear.</p>
      {GROUPS.map(({ group, title }) => {
        const items = equipment.filter(item => item.group === group);
        const keys = items.map(item => item.key);
        const missingCount = keys.filter(key => missing.has(key)).length;
        return <fieldset key={group} className="gym-equipment-group">
          <div className="gym-equipment-group-head">
            <legend>{title}</legend>
            <Button variant="tertiary" disabled={busy} onClick={() => setAvailable(keys, missingCount > 0)}>
              {missingCount > 0 ? 'Mark all available' : 'Mark all missing'}
            </Button>
          </div>
          <ul className="gym-equipment-list">
            {rows(items).map(row => <li key={row.name} className={`gym-equipment-row${row.items.length > 1 ? ' builds' : ''}`}>
              <span className="gym-equipment-name">{row.name}</span>
              <span className="gym-equipment-switches">
                {row.items.map(item => <span key={item.key} className="gym-equipment-switch">
                  {item.machine && <span aria-hidden="true">{item.label}</span>}
                  <Switch label={item.machine ? `${item.machine}, ${item.label.toLowerCase()}` : item.label}
                    checked={!missing.has(item.key)} disabled={busy} onChange={available => setAvailable([item.key], available)} />
                </span>)}
              </span>
            </li>)}
          </ul>
        </fieldset>;
      })}
      <section className="gym-overrides" aria-labelledby="gym-overrides-title">
        <h4 id="gym-overrides-title">Exercises set by hand</h4>
        {overrideEntries.length === 0
          ? <p className="muted small-copy">None. Set an exercise from its details in Exercises when the equipment list does not tell the whole story.</p>
          : <ul className="gym-equipment-list">
            {overrideEntries.map(([id, value]) => <li key={id} className="gym-equipment-row">
              <span className="gym-equipment-name">{exerciseNames.get(id) ?? 'An exercise no longer in your library'}
                <span className="muted small-copy"> · {value === 'available' ? 'Available here' : 'Not available here'}</span></span>
              <Button variant="tertiary" disabled={busy} onClick={() => setOverrides(({ [id]: _removed, ...rest }) => rest)}>
                Reset to auto
              </Button>
            </li>)}
          </ul>}
      </section>
      </div>
      <div className="modal-actions gym-editor-actions">
        {profile.active
          ? <p className="muted small-copy gym-editor-delete-note">Switch to another gym before deleting this one.</p>
          : confirmDelete
            ? <Button variant="destructive" disabled={busy} onClick={() => void onDelete()}><Trash2 size={15} aria-hidden="true" /> Delete {profile.name}</Button>
            : <Button variant="tertiary" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete gym</Button>}
        <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy}>Save</Button>
      </div>
    </form>
  </Modal>;
}

/** Names for hand-set exercises; read only when there are some to name. */
function useExerciseNames(needed: boolean): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    api.exercises(controller.signal)
      .then((exercises: Exercise[]) => setNames(new Map(exercises.map(exercise => [exercise.id, exercise.name]))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [needed]);
  return names;
}
