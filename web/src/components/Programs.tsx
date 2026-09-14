import { useState, type Dispatch, type SetStateAction } from 'react';
import { ArrowRight, Dumbbell, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Bootstrap, Exercise, ProgramSummary, SetPrescription, Template, TemplateExercise } from '../types';
import { ApiError, api } from '../lib/api';
import { showReps } from '../lib/training';
import { validateTemplateDraft } from '../lib/validation';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ExerciseLibrary } from './Exercises';

type Draft = { id: string | null; name: string; focus: string; revision: number | null; exercises: TemplateExercise[] };

const blankSet = (loadModel?: Exercise['loadModel']): SetPrescription => ({ repMin: 8, repMax: 12, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsText: null, restText: null, percent1Rm: null, rir: null, warmup: false, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited', resistanceMode: loadModel === 'full_bodyweight' ? 'bodyweight' : loadModel === 'bodyweight_context_only' || loadModel === 'reps_only' ? 'reps_only' : 'external' });

function updateSet(setDraft: Dispatch<SetStateAction<Draft | null>>, draft: Draft, exerciseIndex: number, setIndex: number, patch: Partial<SetPrescription>) {
  setDraft({ ...draft, exercises: draft.exercises.map((exercise, index) => index === exerciseIndex
    ? { ...exercise, sets: exercise.sets.map((set, current) => current === setIndex ? { ...set, ...patch } : set) }
    : exercise) });
}

const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function nextMondayIso() {
  const date = new Date();
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? 1 : 8 - day));
  return date.toISOString().slice(0, 10);
}

function defaultWeekdays(days: ProgramSummary['days']) {
  return Object.fromEntries(days.filter(day => !day.isRestDay).map(day => [day.id, day.weekday ?? (day.position % 7) + 1]));
}

export function Programs({ data, exercises, onStart, onImport, onChanged }: {
  data: Bootstrap; exercises: Exercise[]; onStart: (templateId: string) => void; onImport: () => void; onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (template?: Template) => {
    setDraft(template
      ? { id: template.id, name: template.name, focus: template.focus, revision: template.revision, exercises: structuredClone(template.exercises) }
      : { id: null, name: '', focus: 'Custom workout', revision: null, exercises: [] });
    setPicking(false); setDeleting(false); setError('');
  };

  async function save() {
    if (!draft) return;
    const validationError = validateTemplateDraft(draft.name, draft.focus, draft.exercises);
    if (validationError) { setError(validationError); return; }
    setBusy(true);
    const input = {
      name: draft.name.trim(), focus: draft.focus.trim(), note: null, revision: draft.revision, idempotencyId: crypto.randomUUID(),
      exercises: draft.exercises.map(e => ({ exerciseId: e.exerciseId, sourceName: e.sourceName || e.name, note: e.note || null, sets: e.sets }))
    };
    try {
      if (draft.id) await api.updateTemplate(draft.id, input); else await api.createTemplate(input);
      await onChanged();
      setDraft(null);
    } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not save this workout.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!draft?.id) return;
    setBusy(true);
    try { await api.deleteTemplate(draft.id); await onChanged(); setDeleting(false); setDraft(null); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not delete this workout.'); setDeleting(false); }
    finally { setBusy(false); }
  }

  return <>
    <div className="page-heading">
      <div><div className="eyebrow">A PLAN YOU CAN MAKE YOUR OWN</div><h1>Your workouts<span className="accent">.</span></h1><p>Build a workout by hand, or import a training program from a PDF.</p></div>
      <div className="heading-actions">
        <Button onClick={onImport}><FileText size={18} />Import a PDF program</Button>
        <Button variant="primary" onClick={() => open()}><Plus size={18} />New workout</Button>
      </div>
    </div>

    {data.programs.map(program => <ProgramCard key={program.id} program={program} onStart={onStart} onChanged={onChanged} />)}

    <section className="panel">
      <div className="section-heading"><h2>Standalone workouts</h2><span className="muted">{data.templates.length} saved</span></div>
      {data.templates.length ? <div className="program-grid">{data.templates.map((template, i) => <section className="panel routine-card" key={template.id}>
        <div className="section-heading"><span className="routine-number">WORKOUT {String(i + 1).padStart(2, '0')}</span>
          <Button variant="tertiary" aria-label={`Edit ${template.name}`} onClick={() => open(template)}><Pencil size={17} /></Button></div>
        <h2>{template.name}</h2><p>{template.focus}</p>
        <div className="routine-exercises">{template.exercises.map(e => <div key={e.id}>
          <span><Dumbbell size={16} />{e.name}</span><small>{e.sets.length} × {showReps(e.sets[0])}</small>
        </div>)}</div>
        <Button className="full-width" onClick={() => onStart(template.id)}>Start workout<ArrowRight size={17} /></Button>
      </section>)}</div>
        : <div className="empty-message"><Dumbbell size={30} /><h3>No standalone workouts yet</h3>
          <p>{exercises.length ? 'Build one by hand, or import a program from a PDF.' : 'The exercise library is still empty, so a workout cannot be built yet. Importing a PDF will still create a reviewable draft.'}</p>
          <Button variant="primary" onClick={() => open()}><Plus size={17} />New workout</Button></div>}
    </section>

    {draft && <Modal title={draft.id ? `Edit ${draft.name || 'workout'}` : 'Build a workout'} onClose={() => setDraft(null)} wide>
      <div className="modal-body">
        <label className="field">Workout name<input name="template-name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Full body strength" /></label>
        <label className="field">Focus<input name="template-focus" value={draft.focus} onChange={e => setDraft({ ...draft, focus: e.target.value })} /></label>
        <div className="editor-exercises">{draft.exercises.map((exercise, i) => <div className="editor-row" key={exercise.id}>
          <div className="section-heading"><strong>{exercise.name}</strong><Button variant="tertiary" aria-label={`Remove ${exercise.name}`} onClick={() => setDraft({ ...draft, exercises: draft.exercises.filter((_, j) => j !== i) })}><Trash2 size={16} /></Button></div>
          <div className="set-editor" aria-label={`Set prescriptions for ${exercise.name}`}>
            {exercise.sets.map((set, si) => <div className="set-editor-row" key={si}>
              <span className="tiny-label">SET {si + 1}</span>
              <label>Min reps<input name={`rep-min-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} minimum reps`} type="number" min="1" max="1000" value={set.repMin} onChange={e => updateSet(setDraft, draft, i, si, { repMin: Number(e.target.value), repMax: Math.max(Number(e.target.value), set.repMax) })} /></label>
              <label>Max reps<input name={`rep-max-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} maximum reps`} type="number" min="1" max="1000" value={set.repMax} onChange={e => updateSet(setDraft, draft, i, si, { repMax: Number(e.target.value) })} /></label>
              <label>Target RPE<input name={`target-rpe-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} target RPE`} type="number" min="6" max="10" step="0.5" value={set.targetRpe ?? ''} placeholder={set.warmup ? 'optional' : '6–10'} onChange={e => updateSet(setDraft, draft, i, si, { targetRpe: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label>Rest (s)<input name={`rest-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} rest seconds`} type="number" min="0" max="3600" value={set.restSeconds ?? ''} onChange={e => updateSet(setDraft, draft, i, si, { restSeconds: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label>Tempo<input name={`tempo-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} tempo`} value={set.tempo ?? ''} onChange={e => updateSet(setDraft, draft, i, si, { tempo: e.target.value || null })} placeholder="e.g. 3010" /></label>
              <label>Note<input name={`set-note-${exercise.id}-${si}`} aria-label={`${exercise.name} set ${si + 1} note`} value={set.notes ?? ''} onChange={e => updateSet(setDraft, draft, i, si, { notes: e.target.value || null })} /></label>
              <label className="checkbox-field"><input type="checkbox" name={`warmup-${exercise.id}-${si}`} checked={set.warmup} onChange={e => updateSet(setDraft, draft, i, si, { warmup: e.target.checked, targetRpe: e.target.checked ? null : set.targetRpe ?? 8 })} />Warm-up</label>
              <Button variant="tertiary" aria-label={`Remove ${exercise.name} set ${si + 1}`} disabled={exercise.sets.length <= 1} onClick={() => setDraft({ ...draft, exercises: draft.exercises.map((item, index) => index === i ? { ...item, sets: item.sets.filter((_, current) => current !== si) } : item) })}><Trash2 size={14} /></Button>
            </div>)}
            <Button variant="tertiary" disabled={exercise.sets.length >= 24} onClick={() => setDraft({ ...draft, exercises: draft.exercises.map((item, index) => index === i ? { ...item, sets: [...item.sets, blankSet(item.loadModel)] } : item) })}><Plus size={15} />Add set</Button>
          </div>
        </div>)}</div>
        <Button onClick={() => setPicking(!picking)}><Plus size={17} />{picking ? 'Hide exercise picker' : 'Add exercise'}</Button>
        {picking && <ExerciseLibrary exercises={exercises} exclude={draft.exercises.map(e => e.exerciseId).filter((id): id is string => id !== null)} onSelect={id => {
          const chosen = exercises.find(e => e.id === id)!;
          setDraft({ ...draft, exercises: [...draft.exercises, { id: crypto.randomUUID(), exerciseId: chosen.id, sourceName: chosen.name, name: chosen.name, note: '', position: draft.exercises.length, sets: [blankSet(chosen.loadModel), blankSet(chosen.loadModel), blankSet(chosen.loadModel)], sequenceGroup: '', substitutions: [], loadModel: chosen.loadModel }] });
          setPicking(false);
        }} />}
        {error && <p role="alert" className="error-text">{error}</p>}
      </div>
      <div className="modal-actions">
        {draft.id && <Button variant="destructive" disabled={busy} onClick={() => setDeleting(true)}>Delete workout</Button>}
        <Button onClick={() => setDraft(null)}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save workout'}</Button>
      </div>
      {deleting && <Modal title="Delete this workout?" onClose={() => setDeleting(false)}>
        <div className="modal-body"><p>Your completed sessions stay in your history.</p></div>
        <div className="modal-actions"><Button onClick={() => setDeleting(false)}>Keep workout</Button><Button variant="destructive" disabled={busy} onClick={remove}>Delete workout</Button></div>
      </Modal>}
    </Modal>}
  </>;
}

function ProgramCard({ program, onStart, onChanged }: { program: ProgramSummary; onStart: (id: string) => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<Template[] | null>(null);
  const [scheduling, setScheduling] = useState(program.needsSchedule ?? false);
  const [scheduleAnchor, setScheduleAnchor] = useState(program.scheduleAnchor ?? nextMondayIso());
  const [scheduleWeekdays, setScheduleWeekdays] = useState<Record<string, number>>(() => defaultWeekdays(program.days));
  const next = program.days.find(w => w.id === program.nextTemplateId);

  async function toggleDetails() {
    if (!expanded && detail === null) {
      setBusy(true); setError('');
      try { setDetail((await api.getProgram(program.id)).workouts); }
      catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not load this program.'); }
      finally { setBusy(false); }
    }
    setExpanded(value => !value);
  }

  async function act(run: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await run(); await onChanged(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not update this program.'); }
    finally { setBusy(false); }
  }

  function openSchedule() {
    setScheduleAnchor(program.scheduleAnchor ?? nextMondayIso());
    setScheduleWeekdays(defaultWeekdays(program.days));
    setScheduling(true);
  }

  async function saveSchedule() {
    const slots = program.days.filter(day => !day.isRestDay).map(day => ({ templateId: day.id, weekday: scheduleWeekdays[day.id] ?? 1 }));
    await act(async () => {
      await api.scheduleProgram(program.id, { anchor: scheduleAnchor, slots, revision: program.revision });
      setScheduling(false);
    });
  }

  return <section className="panel program-card">
    <div className="section-heading">
      <div><h2>{program.name}</h2><p className="muted">{program.weeks} {program.weeks === 1 ? 'week' : 'weeks'} · {program.days.length} days · {program.completedTemplateIds.length} completed</p></div>
      <span className="tiny-label accent">{program.active ? 'ACTIVE' : 'INACTIVE'}</span>
    </div>
    {program.description && <p>{program.description}</p>}
    <Button variant="tertiary" className="full-width" onClick={() => void toggleDetails()} disabled={busy}>{busy ? 'Loading program…' : expanded ? 'Hide program detail' : 'Show block and phase detail'}</Button>
    {expanded && <ProgramTree days={program.days} completed={program.completedTemplateIds} nextId={program.nextTemplateId} detail={detail} onStart={onStart} />}
    {error && <p className="error-text" role="alert">{error}</p>}
    {program.needsSchedule && !scheduling && <div className="empty-message">
      <strong>Choose when this program happens</strong>
      <p>Set a Monday start and a weekday for each workout before activating the program.</p>
      <Button onClick={openSchedule}>Schedule workouts</Button>
    </div>}
    {!program.needsSchedule && !scheduling && <div className="settings-actions">
      <Button variant="tertiary" onClick={openSchedule}>Edit schedule</Button>
    </div>}
    {scheduling && <div className="schedule-editor" aria-label={`Schedule ${program.name}`}>
      <label className="field">Program week 1 starts on Monday<input type="date" value={scheduleAnchor} onChange={event => setScheduleAnchor(event.target.value)} /></label>
      <div className="schedule-rows">
        {program.days.filter(day => !day.isRestDay).map(day => <label className="field" key={day.id}>{day.name} · week {day.week}
          <select value={scheduleWeekdays[day.id] ?? 1} onChange={event => setScheduleWeekdays(current => ({ ...current, [day.id]: Number(event.target.value) }))}>
            {weekdayNames.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}
          </select>
        </label>)}
      </div>
      <div className="settings-actions"><Button variant="primary" disabled={busy || !scheduleAnchor} onClick={() => void saveSchedule()}>Save schedule</Button><Button disabled={busy} onClick={() => setScheduling(false)}>Cancel</Button></div>
    </div>}
    <div className="settings-actions">
      {next && <Button variant="primary" onClick={() => onStart(next.id)}>Start {next.name}<ArrowRight size={16} /></Button>}
      <Button disabled={busy} onClick={() => act(() => api.setProgramActive(program.id, !program.active, program.revision))}>{program.active ? 'Make inactive' : 'Make active'}</Button>
      <Button variant="destructive" disabled={busy} onClick={() => act(() => api.deleteProgram(program.id))}>Delete program</Button>
    </div>
  </section>;
}

function ProgramTree({ days, completed, nextId, detail, onStart }: { days: ProgramSummary['days']; completed: string[]; nextId: string | null; detail: Template[] | null; onStart: (id: string) => void }) {
  const blocks = new Map<string, Map<string, typeof days>>();
  for (const day of days) {
    const block = day.block || 'Program';
    const phase = day.phase || 'General';
    if (!blocks.has(block)) blocks.set(block, new Map());
    const phases = blocks.get(block)!;
    if (!phases.has(phase)) phases.set(phase, []);
    phases.get(phase)!.push(day);
  }
  return <div className="program-tree">{[...blocks].map(([block, phases]) => <details key={block} open>
    <summary>{block}</summary>
    {[...phases].map(([phase, phaseDays]) => <details key={phase} className="phase-tree" open>
      <summary>{phase}</summary>
      <div className="routine-list">{phaseDays.map(day => {
        const full = detail?.find(template => template.id === day.id);
        const complete = completed.includes(day.id);
        const row = <><span className="routine-number">W{day.phaseWeek}</span><span>{day.name}</span><span className="tiny-label">{day.isRestDay ? 'REST DAY' : complete ? 'DONE' : day.id === nextId ? 'UP NEXT' : `${full?.exercises.length ?? day.exerciseCount} exercises`}</span></>;
        return day.isRestDay ? <div className="routine-row rest-row" key={day.id}>{row}</div> : <Button variant="tertiary" className={`routine-row ${day.id === nextId ? 'next' : ''}`} key={day.id} onClick={() => onStart(day.id)}>{row}</Button>;
      })}</div>
    </details>)}
  </details>)}</div>;
}
