import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clock3, Dumbbell, Minus, Plus, Timer, Trash2, TrendingUp } from 'lucide-react';
import type { Exercise, LoggedSet, Preferences, Session, SessionExercise } from '../types';
import { ApiError, api } from '../lib/api';
import type { SaveQueue } from '../lib/queue';
import { canComplete, completedSets, normalizeExerciseName, plannedSets, rpeSteps, showClock, showTarget, showVolume, showWeight, toDisplay, toKg } from '../lib/training';
import { restTimer } from '../lib/restTimer';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';

const payload = (session: Session, revision: number) => ({
  note: session.note, revision,
  exercises: session.exercises.map(e => ({
    exerciseId: e.exerciseId, nameSnapshot: e.name, note: e.note, prescription: e.prescription,
    sequenceGroup: e.sequenceGroup, substitutions: e.substitutions,
    sets: e.sets.map(s => ({ weightKg: s.weightKg, reps: s.reps, rpe: s.rpe, done: s.done, warmup: s.warmup }))
  }))
});

export function Workout({ session, preferences, exercises, queue, onSaved, onClose, onFinish, onDiscard }: {
  session: Session; preferences: Preferences; exercises: Exercise[]; queue: SaveQueue;
  onSaved: (s: Session) => void; onClose: () => void; onFinish: (s: Session) => void; onDiscard: () => void;
}) {
  const [draft, setDraft] = useState(session);
  const [now, setNow] = useState(Date.now());
  const [rest, setRest] = useState(restTimer.current);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState<'finish' | 'discard' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(session.revision);

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  // The timer outlives this component: minimising the workout must not cancel a rest that is
  // already counting, so the state lives in the module and the view only listens to it.
  useEffect(() => restTimer.subscribe(setRest), []);

  function change(next: Session) {
    setDraft(next);
    queue.push('workout', async () => {
      const saved = await api.saveWorkout(next.id, payload(next, revision.current));
      revision.current = saved.revision; onSaved(saved);
    });
  }

  function editSet(ei: number, si: number, patch: Partial<LoggedSet>) {
    change({ ...draft, exercises: draft.exercises.map((e, i) => i === ei ? { ...e, sets: e.sets.map((s, j) => j === si ? { ...s, ...patch } : s) } : e) });
  }

  function toggle(ei: number, si: number) {
    const set = draft.exercises[ei].sets[si];
    if (!set.done && !canComplete(set)) { setError('Enter 1–1,000 reps and an RPE from 1 to 10 before logging this set.'); return; }
    setError(''); editSet(ei, si, { done: !set.done });
    const plan = draft.exercises[ei].prescription[si];
    const seconds = plan?.restSeconds ?? preferences.restSeconds;
    // Started from inside the tap, which is the only moment a browser will let the app open the
    // audio session the alert depends on once the screen goes off.
    if (!set.done && seconds > 0) restTimer.start(seconds);
  }

  async function finish() {
    setBusy(true);
    try { const saved = await api.finishWorkout(draft.id, revision.current); restTimer.skip(); onFinish(saved); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not save this workout.'); setBusy(false); setConfirm(null); }
  }

  async function discard() {
    setBusy(true);
    try { await api.discardWorkout(draft.id); onDiscard(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not discard this workout.'); setBusy(false); setConfirm(null); }
  }

  const elapsed = Math.max(0, Math.floor((now - Date.parse(draft.startedAt)) / 1000));
  const remaining = rest.endsAt === 0 ? 0 : Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
  const done = completedSets(draft).length;
  const unit = preferences.unit;
  const groups: SessionExercise[][] = [];
  for (const exercise of draft.exercises) {
    const prefix = exercise.sequenceGroup?.match(/^[A-Za-z]+/)?.[0] ?? '';
    const previous = groups.at(-1)?.[0]?.sequenceGroup?.match(/^[A-Za-z]+/)?.[0] ?? '';
    if (prefix && prefix === previous) groups.at(-1)!.push(exercise); else groups.push([exercise]);
  }

  return <Modal title={draft.name} onClose={onClose} wide>
    <div className="workout-summary"><span><Clock3 size={16} />{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
      <span><Check size={16} />{done} / {plannedSets(draft)} working sets</span><span><Dumbbell size={16} />{showVolume(draft.volumeKg, unit)}</span></div>
    <div className="modal-body workout-body">
      <div className="workout-hint">Enter your working weight, reps, and how hard the set felt. Warm-ups stay separate from working volume.</div>
      {groups.map((group, groupIndex) => <div className={group.length > 1 ? 'superset-block' : ''} key={groupIndex}>
        {group.length > 1 && <div className="superset-heading">SUPERSET {group[0].sequenceGroup.match(/^[A-Za-z]+/)?.[0] ?? ''}</div>}
        {group.map(exercise => <ExerciseBlock key={exercise.id} exercise={exercise} index={draft.exercises.indexOf(exercise)} unit={unit} draft={draft} exercises={exercises} change={change} editSet={editSet} toggle={toggle} />)}
      </div>)}
      <Button className="full-width" onClick={() => setPicker(true)}><Plus size={18} />Add exercise</Button>
      <label className="field">Workout notes<textarea name="workout-note" maxLength={4000} placeholder="How did the session feel?" value={draft.note} onChange={e => change({ ...draft, note: e.target.value })} /></label>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
    <div className="workout-footer"><div className={`rest-control ${remaining > 0 ? 'resting' : ''}`}>
      <Timer size={19} />
      <span className="rest-clock" role="timer" aria-live="off">{remaining > 0 ? `${showClock(remaining)} rest` : 'Rest timer'}</span>
      {remaining > 0 && <span className="rest-track" aria-hidden="true"><span style={{ width: `${rest.totalSeconds > 0 ? Math.min(100, (remaining / rest.totalSeconds) * 100) : 0}%` }} /></span>}
      <Button variant="tertiary" aria-label={remaining > 0 ? 'Add 30 seconds of rest' : `Start a ${preferences.restSeconds} second rest`}
        onClick={() => remaining > 0 ? restTimer.extend(30) : restTimer.start(preferences.restSeconds)}>+{remaining > 0 ? '30s' : `${preferences.restSeconds}s`}</Button>
      {remaining > 0 && <Button variant="tertiary" onClick={() => restTimer.skip()}>Skip</Button>}</div>
      <div className="modal-actions"><Button variant="destructive" disabled={busy} onClick={() => setConfirm('discard')}>Discard</Button><Button onClick={onClose}>Minimize</Button>
        <Button variant="primary" disabled={busy} onClick={() => { if (!done) { setError('Complete at least one working set before finishing.'); return; } setConfirm('finish'); }}>Finish workout<Check size={17} /></Button></div></div>
    {picker && <Modal title="Add an exercise" onClose={() => setPicker(false)}><div className="modal-body"><ExerciseLibrary exercises={exercises} exclude={draft.exercises.map(e => e.exerciseId).filter((id): id is string => id !== null)} onSelect={id => {
      const chosen = exercises.find(e => e.id === id)!;
      change({ ...draft, exercises: [...draft.exercises, { id: crypto.randomUUID(), exerciseId: chosen.id, name: chosen.name, position: draft.exercises.length, note: '', sequenceGroup: '', substitutions: [], prescription: [blankPrescription(preferences.restSeconds)], sets: [blankLoggedSet()], progression: null }] });
      setPicker(false);
    }} /></div></Modal>}
    {confirm && <Modal title={confirm === 'finish' ? 'Finish your workout?' : 'Discard this workout?'} onClose={() => setConfirm(null)}><div className="modal-body"><p>{confirm === 'finish' ? `${done} completed working ${done === 1 ? 'set' : 'sets'} will be saved. Unlogged sets will be left out.` : 'This removes the session in progress. Your completed history stays as it is.'}</p></div>
      <div className="modal-actions"><Button onClick={() => setConfirm(null)}>Keep training</Button><Button variant={confirm === 'finish' ? 'primary' : 'destructive'} disabled={busy} onClick={() => confirm === 'finish' ? void finish() : void discard()}>{confirm === 'finish' ? 'Save workout' : 'Discard workout'}</Button></div></Modal>}
  </Modal>;
}

function ExerciseBlock({ exercise, index, unit, draft, exercises, change, editSet, toggle }: {
  exercise: SessionExercise; index: number; unit: Preferences['unit']; draft: Session; exercises: Exercise[];
  change: (s: Session) => void; editSet: (ei: number, si: number, patch: Partial<LoggedSet>) => void; toggle: (ei: number, si: number) => void;
}) {
  const [swapOpen, setSwapOpen] = useState(false);
  const prescription = exercise.prescription;
  function swap(name: string) {
    const match = exercises.find(item => normalizeExerciseName(item.name) === normalizeExerciseName(name));
    change({ ...draft, exercises: draft.exercises.map((item, i) => i === index ? { ...item, name, exerciseId: match?.id ?? null } : item) });
    setSwapOpen(false);
  }
  return <section className="logging-exercise"><div className="section-heading"><div><h3>{exercise.name}</h3>{!exercise.exerciseId && <span className="tiny-label">NOT IN LIBRARY</span>}</div>
    <div className="topbar-actions">{exercise.substitutions.length > 0 && <Button variant="tertiary" onClick={() => setSwapOpen(value => !value)}>Swap</Button>}<Button variant="tertiary" aria-label={`Remove ${exercise.name}`} onClick={() => change({ ...draft, exercises: draft.exercises.filter((_, i) => i !== index) })}><Trash2 size={16} /></Button></div></div>
    {swapOpen && <div className="swap-menu" role="group" aria-label={`Substitutions for ${exercise.name}`}>{exercise.substitutions.map(name => <Button key={name} variant="tertiary" onClick={() => swap(name)}>{name}</Button>)}</div>}
    {exercise.progression && <p className="progression-note"><TrendingUp size={14} aria-hidden="true" />
      <span>{exercise.progression.suggestedKg === null ? '' : <strong>{showWeight(exercise.progression.suggestedKg, unit)} · </strong>}{exercise.progression.reason}</span>
      {exercise.progression.trendE1rmKg !== null && <small title="Estimated from your logged reps and RPE, not a max you have tested.">Estimated max {showWeight(exercise.progression.trendE1rmKg, unit)}</small>}</p>}
    {prescription.some(p => p.notes || p.loadText || p.tempo || p.percent1Rm || p.rir) && <details><summary>Plan detail <ChevronDown size={13} /></summary><ul>{prescription.map((p, i) => {
      const warmupNumber = prescription.slice(0, i + 1).filter(item => item.warmup).length;
      const workingNumber = prescription.slice(0, i + 1).filter(item => !item.warmup).length;
      return <li key={i}>{p.warmup ? `Warm-up ${warmupNumber}` : `Set ${workingNumber}`}: {showTarget(p)}{p.loadText ? ` · ${p.loadText}` : ''}{p.tempo ? `, tempo ${p.tempo}` : ''}{p.notes ? ` — ${p.notes}` : ''}</li>;
    })}</ul></details>}
    <div className="set-table"><div className="set-table-head"><span>SET</span><span>TARGET</span><span>{unit.toUpperCase()}</span><span>REPS</span><span>RPE</span><span>LOG</span><span /></div>
      {exercise.sets.map((set, si) => { const plan = prescription[si] ?? prescription.at(-1); const shown = toDisplay(set.weightKg, unit); const warmup = set.warmup || plan?.warmup;
        const warmupNumber = exercise.sets.slice(0, si + 1).filter((item, index) => item.warmup || prescription[index]?.warmup).length;
        const workingNumber = exercise.sets.slice(0, si + 1).filter((item, index) => !(item.warmup || prescription[index]?.warmup)).length;
        return <div className={`set-row ${set.done ? 'done' : ''} ${warmup ? 'warmup-row' : ''}`} key={set.id}><span className="set-number">{warmup ? `W${warmupNumber}` : workingNumber}</span>
          <span className="previous-set" title={plan?.restText ? `Rest ${plan.restText}` : undefined}>{plan ? showTarget(plan) : '—'}{plan?.rpeSource === 'inferred' && <small className="ai-marker">AI</small>}</span>
          <input name={`weight-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} weight`} inputMode="decimal" type="number" min="0" max="2200" step="0.25" placeholder="—" value={shown === null ? '' : shown} onChange={e => editSet(index, si, { weightKg: e.target.value === '' ? null : toKg(Number(e.target.value), unit), done: false })} />
          <input name={`reps-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} reps`} inputMode="numeric" type="number" min="1" max="1000" placeholder="—" value={set.reps ?? ''} onChange={e => editSet(index, si, { reps: e.target.value === '' ? null : Number(e.target.value), done: false })} />
          <select name={`rpe-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} RPE`} value={set.rpe ?? ''} onChange={e => editSet(index, si, { rpe: e.target.value === '' ? null : Number(e.target.value), done: false })}><option value="">—</option>{rpeSteps.map(step => <option key={step} value={step}>{step}</option>)}</select>
          <Button className="log-set" variant={set.done ? 'primary' : 'secondary'} aria-label={`${set.done ? 'Unlog' : 'Log'} ${exercise.name} set ${si + 1}`} aria-pressed={set.done} onClick={() => toggle(index, si)}><Check size={18} /></Button>
          <Button variant="tertiary" aria-label={`Remove ${exercise.name} set ${si + 1}`} onClick={() => change({ ...draft, exercises: draft.exercises.map((item, i) => i === index ? { ...item, sets: item.sets.filter((_, j) => j !== si), prescription: item.prescription.filter((_, j) => j !== si) } : item) })}><Minus size={14} /></Button>
        </div>;
      })}
    </div>
    <div className="exercise-actions"><input name={`note-${exercise.id}`} aria-label={`Notes for ${exercise.name}`} placeholder="Add an exercise note…" value={exercise.note} maxLength={1000} onChange={e => change({ ...draft, exercises: draft.exercises.map((item, i) => i === index ? { ...item, note: e.target.value } : item) })} />
      <Button variant="tertiary" disabled={exercise.sets.length >= 24} onClick={() => change({ ...draft, exercises: draft.exercises.map((item, i) => i === index ? { ...item, sets: [...item.sets, { ...blankLoggedSet(), position: item.sets.length, weightKg: item.sets.at(-1)?.weightKg ?? null }], prescription: [...item.prescription, { ...blankPrescription(prescription.at(-1)?.restSeconds ?? 90), warmup: false }] } : item) })}><Plus size={15} />Add set</Button></div>
  </section>;
}

function blankPrescription(restSeconds: number): SessionExercise['prescription'][number] {
  return { repMin: 8, repMax: 12, targetRpe: 8, restSeconds, tempo: null, loadText: null, notes: null, repsText: null, restText: null, percent1Rm: null, rir: null, warmup: false, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' };
}
function blankLoggedSet(): LoggedSet { return { id: crypto.randomUUID(), position: 0, weightKg: null, reps: null, rpe: null, done: false, warmup: false }; }
