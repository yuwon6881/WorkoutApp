import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronUp, FileText, Plus, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import type { DraftExercise, DraftSet, DraftWorkout, Exercise, ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { showReps } from '../lib/training';
import { Button } from './ui/Button';

const MAX_BYTES = 20 * 1024 * 1024;

const label: Record<string, string> = { extracted: 'From the PDF', inferred: 'AI suggestion', userEdited: 'Your edit' };

function Source({ source }: { source: string }) {
  return <span className={`tiny-label provenance ${source}`} title={label[source] ?? source}>{label[source] ?? source}</span>;
}

/// The review workflow gets its own page: a multi-week program does not fit a routine dialog,
/// and the reviewer needs room to see every prescription and where each value came from.
export function ImportReview({ exercises, imports, remaining, onBack, onChanged }: {
  exercises: Exercise[]; imports: ImportView[]; remaining: number; onBack: () => void; onChanged: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<ImportView | null>(imports.find(i => i.status === 'ready') ?? null);
  const [draft, setDraft] = useState<ImportDraft | null>(selected?.draft ?? null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(selected?.draft ?? null); }, [selected]);

  async function upload(chosen: File) {
    setError(''); setNotice('');
    if (chosen.size > MAX_BYTES) { setError('That PDF is larger than 20 MB.'); return; }
    if (!/\.pdf$/i.test(chosen.name)) { setError('Choose a PDF file.'); return; }
    setBusy('Reading your program. This can take a minute for a long PDF…');
    try {
      const view = await api.uploadImport(chosen);
      setSelected(view);
      setNotice(view.unresolved.length
        ? `Read ${view.draft?.workouts.length ?? 0} workouts. ${view.unresolved.length} exercises still need mapping.`
        : `Read ${view.draft?.workouts.length ?? 0} workouts. Every exercise is mapped.`);
      await onChanged();
    } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not read that PDF.'); }
    finally { setBusy(''); }
  }

  async function persist(next: ImportDraft) {
    if (!selected) return;
    setDraft(next);
    setBusy('Saving your changes…'); setError('');
    try { const view = await api.editImport(selected.id, next); setSelected(view); await onChanged(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not save your changes.'); }
    finally { setBusy(''); }
  }

  async function act(kind: string, run: () => Promise<unknown>) {
    setBusy(kind); setError('');
    try { await run(); await onChanged(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'That did not work. Try again.'); }
    finally { setBusy(''); }
  }

  return <>
    <div className="page-heading">
      <div>
        <Button variant="tertiary" onClick={onBack}><ArrowLeft size={16} />Back to workouts</Button>
        <div className="eyebrow">TURN A PDF INTO A PROGRAM</div>
        <h1>Import a program<span className="accent">.</span></h1>
        <p>Upload a training PDF. Everything it reads lands in a draft you review and correct before anything is saved as a program.</p>
      </div>
      <span className="pill">{remaining} imports left today</span>
    </div>

    <section className="panel">
      <div className="section-heading"><h2>Upload</h2><span className="muted">PDF · up to 20 MB · up to 100 pages</span></div>
      <input name="program-pdf" ref={file} type="file" accept="application/pdf,.pdf" hidden aria-label="Program PDF"
        onChange={e => { const chosen = e.target.files?.[0]; e.target.value = ''; if (chosen) void upload(chosen); }} />
      <Button variant="primary" disabled={!!busy} onClick={() => file.current?.click()}><Upload size={17} />Choose a PDF</Button>
      {busy && <p className="muted" role="status">{busy}</p>}
      {notice && <p className="muted" role="status">{notice}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <p className="muted small-copy">The PDF is read once and never stored. If an import fails, upload the file again.</p>
    </section>

    {imports.length > 0 && <section className="panel">
      <div className="section-heading"><h2>Your imports</h2><span className="muted">{imports.length}</span></div>
      {imports.map(view => <Button key={view.id} variant="tertiary" className={`history-row ${selected?.id === view.id ? 'selected' : ''}`} onClick={() => setSelected(view)}>
        <span className="exercise-icon"><FileText size={19} /></span>
        <span className="row-title"><strong>{view.fileName}</strong><small>{new Date(view.created).toLocaleString()} · {view.status}{view.error ? ` · ${view.error}` : ''}</small></span>
        {view.status === 'ready' && <span className="tiny-label">{view.unresolved.length ? `${view.unresolved.length} to map` : 'ready'}</span>}
      </Button>)}
    </section>}

    {selected && draft && selected.status === 'ready' && <>
      <section className="panel">
        <div className="section-heading"><h2>Review</h2><span className="tiny-label">READ BY {selected.model || 'AI'}</span></div>
        <label className="field">Program name<input name="import-program-name" maxLength={120} value={draft.programName} onChange={e => setDraft({ ...draft, programName: e.target.value })} onBlur={() => persist(draft)} /></label>
        <label className="field">Description<textarea name="import-description" maxLength={4000} value={draft.description ?? ''} onChange={e => setDraft({ ...draft, description: e.target.value })} onBlur={() => persist(draft)} /></label>
        {selected.unresolved.length > 0 && <div className="error-banner" role="status">
          <AlertTriangle size={17} />
          {exercises.length
            ? `${selected.unresolved.length} ${selected.unresolved.length === 1 ? 'exercise is' : 'exercises are'} not matched to the library yet. Map each one below to accept this program.`
            : `The exercise library is empty, so none of these ${selected.unresolved.length} exercises can be mapped yet. The draft is saved and will wait until exercises are available.`}
        </div>}
      </section>

      {draft.workouts.map((workout, wi) => <WorkoutBlock key={workout.lineId} workout={workout} index={wi} total={draft.workouts.length} exercises={exercises}
        onChange={next => persist({ ...draft, workouts: draft.workouts.map((w, i) => i === wi ? next : w) })}
        onMove={direction => {
          const target = wi + direction;
          if (target < 0 || target >= draft.workouts.length) return;
          const copy = [...draft.workouts];
          [copy[wi], copy[target]] = [copy[target], copy[wi]];
          persist({ ...draft, workouts: copy });
        }}
        onRemove={() => persist({ ...draft, workouts: draft.workouts.filter((_, i) => i !== wi) })} />)}

      <section className="panel">
        <div className="settings-actions">
          <Button disabled={!!busy} onClick={() => act('rematch', async () => { const view = await api.rematchImport(selected.id); setSelected(view); })}>
            <Wand2 size={17} />Match against the library again
          </Button>
          <Button variant="destructive" disabled={!!busy} onClick={() => act('discard', async () => { await api.discardImport(selected.id); setSelected(null); })}>
            <Trash2 size={17} />Discard draft
          </Button>
          <Button variant="primary" disabled={!!busy || !selected.acceptable} onClick={() => act('accept', async () => { await api.acceptImport(selected.id); setSelected(null); onBack(); })}>
            <Check size={17} />Accept and create program
          </Button>
        </div>
        {!selected.acceptable && <p className="muted small-copy">Accepting stays disabled until every exercise is mapped to the library.</p>}
      </section>
    </>}

    {selected && selected.status === 'failed' && <section className="panel">
      <div className="empty-message"><AlertTriangle size={30} /><h3>That import did not finish</h3><p>{selected.error}</p>
        <p className="muted">The original PDF was not kept, so it needs to be uploaded again.</p></div>
    </section>}
  </>;
}

function WorkoutBlock({ workout, index, total, exercises, onChange, onMove, onRemove }: {
  workout: DraftWorkout; index: number; total: number; exercises: Exercise[];
  onChange: (next: DraftWorkout) => void; onMove: (direction: number) => void; onRemove: () => void;
}) {
  return <section className="panel">
    <div className="section-heading">
      <div><span className="tiny-label accent">WEEK {workout.week}</span>
        <input name={`workout-name-${workout.lineId}`} className="inline-input" aria-label={`Name for workout ${index + 1}`} maxLength={120} value={workout.name} onChange={e => onChange({ ...workout, name: e.target.value })} /></div>
      <div className="topbar-actions">
        <Button variant="tertiary" aria-label={`Move ${workout.name} earlier`} disabled={index === 0} onClick={() => onMove(-1)}><ChevronUp size={16} /></Button>
        <Button variant="tertiary" aria-label={`Move ${workout.name} later`} disabled={index === total - 1} onClick={() => onMove(1)}><ChevronDown size={16} /></Button>
        <Button variant="tertiary" aria-label={`Remove ${workout.name}`} onClick={onRemove}><Trash2 size={16} /></Button>
      </div>
    </div>

    {workout.exercises.map((exercise, ei) => <ExerciseRow key={exercise.lineId} exercise={exercise} exercises={exercises}
      onChange={next => onChange({ ...workout, exercises: workout.exercises.map((e, i) => i === ei ? next : e) })}
      onRemove={() => onChange({ ...workout, exercises: workout.exercises.filter((_, i) => i !== ei) })} />)}

    <Button variant="tertiary" onClick={() => onChange({
      ...workout, exercises: [...workout.exercises, {
        lineId: crypto.randomUUID(), sourceName: 'New exercise', exerciseId: null, notes: null,
        sets: [{ repMin: 8, repMax: 12, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }]
      }]
    })}><Plus size={16} />Add exercise</Button>
  </section>;
}

function ExerciseRow({ exercise, exercises, onChange, onRemove }: {
  exercise: DraftExercise; exercises: Exercise[]; onChange: (next: DraftExercise) => void; onRemove: () => void;
}) {
  const editSet = (index: number, patch: Partial<DraftSet>) =>
    onChange({ ...exercise, sets: exercise.sets.map((s, i) => i === index ? { ...s, ...patch } : s) });

  return <div className="import-exercise">
    <div className="section-heading">
      <div>
        <input name={`source-name-${exercise.lineId}`} className="inline-input" aria-label="Exercise name as written in the PDF" maxLength={160} value={exercise.sourceName} onChange={e => onChange({ ...exercise, sourceName: e.target.value })} />
        {!exercise.exerciseId && <span className="tiny-label warn"><AlertTriangle size={12} /> NEEDS MAPPING</span>}
      </div>
      <Button variant="tertiary" aria-label={`Remove ${exercise.sourceName}`} onClick={onRemove}><Trash2 size={15} /></Button>
    </div>

    <label className="field">Library exercise
      <select name={`map-${exercise.lineId}`} aria-label={`Library exercise for ${exercise.sourceName}`} value={exercise.exerciseId ?? ''} onChange={e => onChange({ ...exercise, exerciseId: e.target.value || null })}>
        <option value="">Not mapped</option>
        {exercises.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </label>

    <div className="set-table">
      <div className="set-table-head"><span>SET</span><span>REPS</span><span>RPE</span><span>REST</span><span className="source-cell">SOURCE</span><span /></div>
      {exercise.sets.map((set, i) => <div className="set-row" key={i}>
        <span className="set-number">{i + 1}</span>
        <span className="import-reps">
          <input name={`rep-min-${exercise.lineId}-${i}`} aria-label={`Set ${i + 1} lowest reps`} type="number" min="1" max="1000" value={set.repMin}
            onChange={e => editSet(i, { repMin: Number(e.target.value), repsSource: 'userEdited' })} />
          <input name={`rep-max-${exercise.lineId}-${i}`} aria-label={`Set ${i + 1} highest reps`} type="number" min="1" max="1000" value={set.repMax}
            onChange={e => editSet(i, { repMax: Number(e.target.value), repsSource: 'userEdited' })} />
        </span>
        <input name={`target-rpe-${exercise.lineId}-${i}`} aria-label={`Set ${i + 1} target RPE`} type="number" min="1" max="10" step="0.5" value={set.targetRpe ?? ''}
          onChange={e => editSet(i, { targetRpe: e.target.value === '' ? null : Number(e.target.value), rpeSource: 'userEdited' })} />
        <input name={`rest-${exercise.lineId}-${i}`} aria-label={`Set ${i + 1} rest in seconds`} type="number" min="0" max="3600" value={set.restSeconds ?? ''}
          onChange={e => editSet(i, { restSeconds: e.target.value === '' ? null : Number(e.target.value), restSource: 'userEdited' })} />
        <span className="source-cell"><Source source={set.repsSource} />{set.rpeSource !== set.repsSource && <Source source={set.rpeSource} />}</span>
        <Button variant="tertiary" aria-label={`Remove set ${i + 1}`} disabled={exercise.sets.length === 1} onClick={() => onChange({ ...exercise, sets: exercise.sets.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
      </div>)}
    </div>

    <div className="exercise-actions">
      <span className="muted small-copy">{exercise.sets.length} sets · {showReps(exercise.sets[0])} reps{exercise.sets[0].loadText ? ` · ${exercise.sets[0].loadText}` : ''}</span>
      <Button variant="tertiary" disabled={exercise.sets.length >= 20} onClick={() => onChange({ ...exercise, sets: [...exercise.sets, { ...exercise.sets.at(-1)!, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }] })}>
        <Plus size={15} />Add set
      </Button>
    </div>
    {exercise.notes && <p className="muted small-copy"><Sparkles size={13} /> {exercise.notes}</p>}
  </div>;
}
