import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clock3, Dumbbell, Minus, Plus, Timer, Trash2 } from 'lucide-react';
import type { Exercise, LoggedSet, Preferences, Session, SessionExercise } from '../types';
import { ApiError, api } from '../lib/api';
import type { SaveQueue } from '../lib/queue';
import { canComplete, completedSets, plannedSets, rpeSteps, showReps, showVolume, toDisplay, toKg } from '../lib/training';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';

const payload = (session: Session, revision: number) => ({
  note: session.note, revision,
  exercises: session.exercises.map(e => ({
    exerciseId: e.exerciseId, nameSnapshot: e.name, note: e.note, prescription: e.prescription,
    sets: e.sets.map(s => ({ weightKg: s.weightKg, reps: s.reps, rpe: s.rpe, done: s.done }))
  }))
});

export function Workout({ session, preferences, exercises, queue, onSaved, onClose, onFinish, onDiscard }: {
  session: Session; preferences: Preferences; exercises: Exercise[]; queue: SaveQueue;
  onSaved: (s: Session) => void; onClose: () => void; onFinish: (s: Session) => void; onDiscard: () => void;
}) {
  const [draft, setDraft] = useState(session);
  const [now, setNow] = useState(Date.now());
  const [restEnd, setRestEnd] = useState(0);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState<'finish' | 'discard' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Saves are serialized, so the newest revision the server returned is the one the next
  // write must carry.
  const revision = useRef(session.revision);

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  function change(next: Session) {
    setDraft(next);
    queue.push('workout', async () => {
      const saved = await api.saveWorkout(next.id, payload(next, revision.current));
      revision.current = saved.revision;
      onSaved(saved);
    });
  }

  function editSet(ei: number, si: number, patch: Partial<LoggedSet>) {
    change({ ...draft, exercises: draft.exercises.map((e, i) => i === ei ? { ...e, sets: e.sets.map((s, j) => j === si ? { ...s, ...patch } : s) } : e) });
  }

  function toggle(ei: number, si: number) {
    const set = draft.exercises[ei].sets[si];
    if (!set.done && !canComplete(set)) { setError('Enter 1–1,000 reps and an RPE from 1 to 10 before logging this set.'); return; }
    setError('');
    editSet(ei, si, { done: !set.done });
    if (!set.done && preferences.restSeconds) setRestEnd(Date.now() + preferences.restSeconds * 1000);
  }

  async function finish() {
    setBusy(true);
    try {
      const saved = await api.finishWorkout(draft.id, revision.current);
      setRestEnd(0);
      onFinish(saved);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save this workout.');
      setBusy(false); setConfirm(null);
    }
  }

  async function discard() {
    setBusy(true);
    try { await api.discardWorkout(draft.id); onDiscard(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not discard this workout.'); setBusy(false); setConfirm(null); }
  }

  const elapsed = Math.max(0, Math.floor((now - Date.parse(draft.startedAt)) / 1000));
  const remaining = Math.max(0, Math.ceil((restEnd - now) / 1000));
  const done = completedSets(draft).length;
  const unit = preferences.unit;

  return <Modal title={draft.name} onClose={onClose} wide>
    <div className="workout-summary">
      <span><Clock3 size={16} />{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
      <span><Check size={16} />{done} / {plannedSets(draft)} sets</span>
      <span><Dumbbell size={16} />{showVolume(draft.volumeKg, unit)}</span>
    </div>
    <div className="modal-body workout-body">
      <div className="workout-hint">Enter your working weight, reps, and how hard the set felt. RPE 10 means no reps left; RPE 8 means about two in reserve. Leave the weight blank if you did not record it.</div>
      {draft.exercises.map((exercise, ei) => <ExerciseBlock key={exercise.id} exercise={exercise} index={ei} unit={unit} draft={draft} change={change} editSet={editSet} toggle={toggle} />)}
      <Button className="full-width" onClick={() => setPicker(true)}><Plus size={18} />Add exercise</Button>
      <label className="field">Workout notes
        <textarea name="workout-note" maxLength={4000} placeholder="How did the session feel?" value={draft.note} onChange={e => change({ ...draft, note: e.target.value })} />
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
    <div className="workout-footer">
      <div className="rest-control">
        <Timer size={19} />
        <span>{remaining ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} rest` : 'Rest timer'}</span>
        <Button variant="tertiary" onClick={() => setRestEnd(Date.now() + (remaining ? remaining + 30 : preferences.restSeconds) * 1000)}>+{remaining ? '30s' : `${preferences.restSeconds}s`}</Button>
        {remaining > 0 && <Button variant="tertiary" onClick={() => setRestEnd(0)}>Skip</Button>}
      </div>
      <div className="modal-actions">
        <Button variant="destructive" disabled={busy} onClick={() => setConfirm('discard')}>Discard</Button>
        <Button onClick={onClose}>Minimize</Button>
        <Button variant="primary" disabled={busy} onClick={() => { if (!done) { setError('Complete at least one set before finishing.'); return; } setConfirm('finish'); }}>Finish workout<Check size={17} /></Button>
      </div>
    </div>
    {picker && <Modal title="Add an exercise" onClose={() => setPicker(false)}>
      <div className="modal-body">
        <ExerciseLibrary exercises={exercises} exclude={draft.exercises.map(e => e.exerciseId).filter((id): id is string => id !== null)} onSelect={id => {
          const chosen = exercises.find(e => e.id === id)!;
          change({
            ...draft, exercises: [...draft.exercises, {
              id: crypto.randomUUID(), exerciseId: chosen.id, name: chosen.name, position: draft.exercises.length, note: '',
              prescription: [{ repMin: 8, repMax: 12, targetRpe: 8, restSeconds: preferences.restSeconds, tempo: null, loadText: null, notes: null }],
              sets: [{ id: crypto.randomUUID(), position: 0, weightKg: null, reps: null, rpe: null, done: false }]
            }]
          });
          setPicker(false);
        }} />
      </div>
    </Modal>}
    {confirm && <Modal title={confirm === 'finish' ? 'Finish your workout?' : 'Discard this workout?'} onClose={() => setConfirm(null)}>
      <div className="modal-body"><p>{confirm === 'finish'
        ? `${done} completed ${done === 1 ? 'set' : 'sets'} will be saved. Sets you did not log will be left out.`
        : 'This removes the session in progress. Your completed workout history stays as it is.'}</p></div>
      <div className="modal-actions">
        <Button onClick={() => setConfirm(null)}>Keep training</Button>
        <Button variant={confirm === 'finish' ? 'primary' : 'destructive'} disabled={busy} onClick={() => confirm === 'finish' ? finish() : discard()}>
          {confirm === 'finish' ? 'Save workout' : 'Discard workout'}
        </Button>
      </div>
    </Modal>}
  </Modal>;
}

function ExerciseBlock({ exercise, index, unit, draft, change, editSet, toggle }: {
  exercise: SessionExercise; index: number; unit: Preferences['unit']; draft: Session;
  change: (s: Session) => void; editSet: (ei: number, si: number, patch: Partial<LoggedSet>) => void; toggle: (ei: number, si: number) => void;
}) {
  const prescription = exercise.prescription;
  return <section className="logging-exercise">
    <div className="section-heading">
      <div><h3>{exercise.name}</h3>{!exercise.exerciseId && <span className="tiny-label">NOT IN LIBRARY</span>}</div>
      <Button variant="tertiary" aria-label={`Remove ${exercise.name}`} onClick={() => change({ ...draft, exercises: draft.exercises.filter((_, i) => i !== index) })}><Trash2 size={16} /></Button>
    </div>
    {prescription.some(p => p.notes || p.loadText || p.tempo) && <details><summary>Plan detail <ChevronDown size={13} /></summary>
      <ul>{prescription.map((p, i) => <li key={i}>Set {i + 1}: {showReps(p)} reps{p.loadText ? ` at ${p.loadText}` : ''}{p.tempo ? `, tempo ${p.tempo}` : ''}{p.notes ? ` — ${p.notes}` : ''}</li>)}</ul>
    </details>}
    <div className="set-table">
      <div className="set-table-head"><span>SET</span><span>TARGET</span><span>{unit.toUpperCase()}</span><span>REPS</span><span>RPE</span><span>LOG</span><span /></div>
      {exercise.sets.map((set, si) => {
        const plan = prescription[si] ?? prescription.at(-1);
        const shown = toDisplay(set.weightKg, unit);
        return <div className={`set-row ${set.done ? 'done' : ''}`} key={set.id}>
          <span className="set-number">{si + 1}</span>
          <span className="previous-set">{plan ? `${showReps(plan)}${plan.targetRpe !== null ? ` @ ${plan.targetRpe}` : ''}` : '—'}</span>
          <input name={`weight-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} weight`} inputMode="decimal" type="number" min="0" max="2200" step="0.25" placeholder="—"
            value={shown === null ? '' : shown}
            onChange={e => editSet(index, si, { weightKg: e.target.value === '' ? null : toKg(Number(e.target.value), unit), done: false })} />
          <input name={`reps-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} reps`} inputMode="numeric" type="number" min="1" max="1000" placeholder="—"
            value={set.reps ?? ''}
            onChange={e => editSet(index, si, { reps: e.target.value === '' ? null : Number(e.target.value), done: false })} />
          <select name={`rpe-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} RPE`} value={set.rpe ?? ''} onChange={e => editSet(index, si, { rpe: e.target.value === '' ? null : Number(e.target.value), done: false })}>
            <option value="">—</option>
            {rpeSteps.map(step => <option key={step} value={step}>{step}</option>)}
          </select>
          <Button className="log-set" variant={set.done ? 'primary' : 'secondary'} aria-label={`${set.done ? 'Unlog' : 'Log'} ${exercise.name} set ${si + 1}`} aria-pressed={set.done} onClick={() => toggle(index, si)}><Check size={18} /></Button>
          <Button variant="tertiary" aria-label={`Remove ${exercise.name} set ${si + 1}`} onClick={() => change({ ...draft, exercises: draft.exercises.map((p, i) => i === index ? { ...p, sets: p.sets.filter((_, j) => j !== si) } : p) })}><Minus size={14} /></Button>
        </div>;
      })}
    </div>
    <div className="exercise-actions">
      <input name={`note-${exercise.id}`} aria-label={`Notes for ${exercise.name}`} placeholder="Add an exercise note…" value={exercise.note} maxLength={1000}
        onChange={e => change({ ...draft, exercises: draft.exercises.map((p, i) => i === index ? { ...p, note: e.target.value } : p) })} />
      <Button variant="tertiary" disabled={exercise.sets.length >= 20} onClick={() => change({
        ...draft, exercises: draft.exercises.map((p, i) => i === index ? {
          ...p, sets: [...p.sets, { id: crypto.randomUUID(), position: p.sets.length, weightKg: p.sets.at(-1)?.weightKg ?? null, reps: null, rpe: null, done: false }]
        } : p)
      })}><Plus size={15} />Add set</Button>
    </div>
  </section>;
}
