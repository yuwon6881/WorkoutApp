import { useContext, useEffect, useRef, useState } from 'react';
import { GymAvailabilityContext } from '../lib/gymAvailability';
import { Pencil, Plus } from 'lucide-react';
import type { GymProfile, GymsView } from '../types';
import { api, ApiError } from '../lib/api';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { SettingRow } from './ui/SettingRow';
import { Skeleton } from './ui/Skeleton';
import { GymProfileEditor } from './GymProfileEditor';
import './GymProfileSettings.css';

const NAME_LIMIT = 60;
const FRESH = '';

function summary(profile: GymProfile): string {
  const missing = profile.missingEquipment.length;
  const marked = Object.keys(profile.exerciseOverrides).length;
  const parts = [missing === 0 ? 'All equipment available' : `${missing} ${missing === 1 ? 'item' : 'items'} missing`];
  if (marked > 0) parts.push(`${marked} ${marked === 1 ? 'exercise' : 'exercises'} set by hand`);
  return parts.join(' · ');
}

/// Every gym the lifter trains at. The active one decides missing-equipment warnings, the weights
/// suggestions snap to, and the gym a new workout records.
export function GymProfileSettings({ notify }: { notify: (message: string) => void }) {
  const { gym, apply, switchLocked: hasActiveWorkout = false } = useContext(GymAvailabilityContext);
  const [view, setView] = useState<GymsView | null>(null);
  // An account's first gym is made by this read, so the rest of the app learns of it here.
  const firstGym = view !== null && gym === null;
  useEffect(() => { if (firstGym && view) void apply?.(view); }, [firstGym]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [copyFrom, setCopyFrom] = useState(FRESH);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api.gyms(controller.signal).then(setView).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load your gyms.');
    });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (editing || adding || busy || !trigger.current) return;
    trigger.current.focus();
    trigger.current = null;
  }, [editing, adding, busy]);

  async function run(action: () => Promise<GymsView>, done: string): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      setView(next);
      notify(done);
      await apply?.(next);
      return true;
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Your gyms were not saved. Please retry.');
      // A gym changed elsewhere: read it again so the next save carries its current revision.
      if (failure instanceof ApiError && failure.conflict) {
        try { const fresh = await api.gyms(); setView(fresh); await apply?.(fresh); } catch { /* the message already says to retry */ }
      }
      return false;
    } finally { setBusy(false); }
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) { setNameError('Name the gym.'); return; }
    if (trimmed.length > NAME_LIMIT) { setNameError(`Use ${NAME_LIMIT} characters or fewer.`); return; }
    if (await run(() => api.createGym(trimmed, copyFrom || null), `${trimmed} added.`)) setAdding(false);
  }

  if (!view) return error
    ? <div className="error-banner" role="alert">{error} <Button variant="secondary" onClick={() => setReload(value => value + 1)}>Retry</Button></div>
    : <div className="panel settings-card" role="status" aria-label="Loading your gyms"><Skeleton className="load-settings-skeleton" /></div>;

  const editingProfile = view.profiles.find(profile => profile.id === editing) ?? null;

  return <>
    {/* An open dialog shows its own failure; the page banner would sit behind it. */}
    {error && !adding && !editing && <div className="error-banner" role="alert">{error}</div>}
    <article className="panel settings-card load-settings-group gym-settings" aria-labelledby="gym-settings-title">
      <h3 id="gym-settings-title">Your gyms</h3>
      <p className="muted">
        Exercises that need missing equipment are flagged in programs, imports and workouts.
        {hasActiveWorkout && ' Finish or discard your workout to switch gyms.'}
      </p>
      {view.profiles.map(profile => <SettingRow key={profile.id} descriptionId={`gym-${profile.id}-summary`} description={summary(profile)}
        label={<span className="gym-settings-name"><strong>{profile.name}</strong>{profile.active && <span className="tiny-label gym-active-label">In use</span>}</span>}>
        <div className="gym-settings-row-actions">
          {!profile.active && <Button variant="secondary" disabled={busy || hasActiveWorkout} aria-describedby={`gym-${profile.id}-summary`}
            onClick={() => void run(() => api.activateGym(profile.id), `Now training at ${profile.name}.`)}>Use</Button>}
          <Button variant="secondary" disabled={busy} aria-label={`Edit ${profile.name}`} onClick={event => {
            trigger.current = event.currentTarget;
            setError(''); setEditing(profile.id);
          }}><Pencil size={15} aria-hidden="true" /> Edit</Button>
        </div>
      </SettingRow>)}
      <div className="gym-settings-footer">
        <Button variant="secondary" disabled={busy} onClick={event => {
          trigger.current = event.currentTarget;
          setName(''); setNameError(''); setCopyFrom(FRESH); setError(''); setAdding(true);
        }}><Plus size={15} aria-hidden="true" /> Add gym</Button>
      </div>
    </article>

    {adding && <Modal title="Add a gym" onClose={() => !busy && setAdding(false)}>
      <form className="gym-dialog-form" noValidate onSubmit={event => { event.preventDefault(); void create(); }}>
        <div className="modal-body gym-create-form">
        {error && <div className="error-banner" role="alert">{error}</div>}
        <Field label="Name" name="gym-name" value={name} maxLength={NAME_LIMIT} autoComplete="off" error={nameError}
          onChange={event => { setName(event.target.value); setNameError(''); }} />
        <Select label="Start from" value={copyFrom} onChange={setCopyFrom}
          options={[{ value: FRESH, label: 'Everything available, default weights' },
            ...view.profiles.map(profile => ({ value: profile.id, label: `A copy of ${profile.name}` }))]} />
        </div>
        <div className="modal-actions">
          <Button variant="secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>Add gym</Button>
        </div>
      </form>
    </Modal>}

    {editingProfile && <GymProfileEditor profile={editingProfile} equipment={view.equipment} busy={busy} error={error}
      onClose={() => !busy && setEditing(null)}
      onSave={async input => {
        if (await run(() => api.updateGym(editingProfile.id, { ...input, revision: editingProfile.revision }), `${input.name} saved.`)) setEditing(null);
      }}
      onDelete={async () => {
        if (await run(() => api.deleteGym(editingProfile.id), `${editingProfile.name} deleted.`)) setEditing(null);
      }} />}
  </>;
}
