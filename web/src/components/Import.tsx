import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, FileText, Plus, Trash2, Upload, Wand2 } from 'lucide-react';
import type { DraftExercise, DraftSet, DraftWorkout, Exercise, ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { showReps } from '../lib/training';
import { validateDraftWorkout, validateImportMetadata } from '../lib/validation';
import { Button } from './ui/Button';
import { Field, SelectField, TextAreaField } from './ui/Field';

const MAX_BYTES = 150 * 1024 * 1024;
const RESUMABLE_THRESHOLD = 8 * 1024 * 1024;
const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const sourceLabel: Record<string, string> = { extracted: 'From the PDF', inferred: 'AI suggestion', userEdited: 'Your edit' };

function statusLabel(status: string) {
  return { pending: 'Processing', ready: 'Ready', failed: 'Failed' }[status] ?? 'Unknown status';
}

function Source({ source }: { source: string }) {
  return <span className={`tiny-label provenance ${source}`} title={sourceLabel[source] ?? source}>{sourceLabel[source] ?? source}</span>;
}

export function ImportReview({ exercises, imports, remaining, onBack, onChanged }: {
  exercises: Exercise[]; imports: ImportView[]; remaining: number; onBack: () => void; onChanged: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<ImportView | null>(imports.find(i => i.status === 'ready') ?? imports[0] ?? null);
  const [draft, setDraft] = useState<ImportDraft | null>(selected?.draft ?? null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [acknowledgeUnspecified, setAcknowledgeUnspecified] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const selectedFile = useRef<File | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAcknowledgeUnspecified(false);
    if (!selected) { setDraft(null); return; }
    if (selected.draft) { setDraft(selected.draft); return; }
    setBusy('Loading this import…');
    api.getImport(selected.id).then(view => {
      if (!cancelled) { setSelected(view); setDraft(view.draft); }
    }).catch(failure => { if (!cancelled) setError(failure instanceof ApiError ? failure.message : 'Could not load this import.'); })
      .finally(() => { if (!cancelled) setBusy(''); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  async function continueExtraction(view: ImportView, chosen: File) {
    let current = view;
    while (current.status === 'pending' && current.stage === 'extract' && current.chunksDone < current.chunksTotal) {
      setBusy(`Reading chunk ${current.chunksDone + 1} of ${current.chunksTotal}${current.currentChunkLabel ? ` · ${current.currentChunkLabel}` : ''}…`);
      try {
        try { current = await api.extractImport(current.id); }
        catch (failure) {
          // Legacy/past-expiry imports can still be resumed by explicitly selecting the source PDF.
          if (failure instanceof ApiError && failure.status === 410) current = await api.extractImport(current.id, chosen);
          else throw failure;
        }
        setSelected(current); setDraft(current.draft);
        await onChanged();
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'That extraction chunk failed. Retry with the same PDF.');
        setSelected(current);
        return;
      }
    }
    setSelected(current); setDraft(current.draft);
    if (current.status === 'ready') setNotice(`Read ${current.draft?.workouts.length ?? 0} days. Review the tree before accepting it.`);
  }

  async function upload(chosen: File) {
    selectedFile.current = chosen;
    setAcknowledgeUnspecified(false);
    setError(''); setNotice('');
    if (chosen.size > MAX_BYTES) { setError('That PDF is larger than 150 MiB.'); return; }
    if (!/\.pdf$/i.test(chosen.name)) { setError('Choose a PDF file.'); return; }
    setBusy('Reading the program outline…');
    try {
      let view: ImportView;
      if (chosen.size > RESUMABLE_THRESHOLD) {
        const upload = await api.initImportUpload(chosen.name, chosen.size);
        let offset = upload.receivedBytes;
        while (offset < chosen.size) {
          const end = Math.min(chosen.size, offset + upload.chunkBytes);
          const chunk = new Uint8Array(await chosen.slice(offset, end).arrayBuffer());
          const progress = await api.appendImportUpload(upload.id, offset, chunk);
          offset = progress.receivedBytes;
          setBusy(`Uploading ${Math.round(offset / chosen.size * 100)}%…`);
        }
        setBusy('Reading the program outline…');
        view = await api.completeImportUpload(upload.id);
      } else view = await api.uploadImport(chosen);
      setSelected(view); setDraft(view.draft);
      await onChanged();
      if (view.stage === 'extract') await continueExtraction(view, chosen);
      else if (view.status === 'ready') setNotice(`Read ${view.draft?.workouts.length ?? 0} days. Review the tree before accepting it.`);
    } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not read that PDF.'); }
    finally { setBusy(''); }
  }

  async function persist(next: ImportDraft) {
    if (!selected) return;
    setDraft(next);
    const validationError = validateImportMetadata(next.programName, next.description);
    if (validationError) { setError(validationError); return; }
    setBusy('Saving your changes…'); setError('');
    try { const view = await api.editImport(selected.id, { programName: next.programName, description: next.description }); setSelected(view); setDraft(view.draft); await onChanged(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not save your changes.'); }
    finally { setBusy(''); }
  }

  async function persistDay(day: DraftWorkout) {
    if (!selected) return;
    setDraft(current => current ? { ...current, workouts: current.workouts.map(item => item.lineId === day.lineId ? day : item) } : current);
    const validationError = validateDraftWorkout(day);
    if (validationError) { setError(validationError); return; }
    setBusy('Saving this day…'); setError('');
    try { const view = await api.editImportDay(selected.id, day); setSelected(view); setDraft(view.draft); await onChanged(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not save this day.'); }
    finally { setBusy(''); }
  }

  async function act(kind: string, run: () => Promise<unknown>) {
    setBusy(kind); setError('');
    try { await run(); await onChanged(); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'That did not work. Try again.'); }
    finally { setBusy(''); }
  }

  const requiresAcknowledgement = !!selected?.reviewIssues?.some(issue => issue.code === 'rpe_unspecified' || issue.code === 'rest_unspecified');

  return <>
    <div className="page-heading">
      <div>
        <div className="back-nav-row">
          <Button variant="tertiary" className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to workouts</Button>
        </div>
        <h1>Import a program</h1>
      </div>
      <span className="pill">{remaining} AI reads left today</span>
    </div>

    <section className="panel">
      <div className="section-heading"><h2>Upload</h2><span className="muted">PDF · up to 150 MiB · up to 1,000 pages</span></div>
      <input name="program-pdf" ref={file} type="file" accept="application/pdf,.pdf" hidden aria-label="Program PDF"
        onChange={e => { const chosen = e.target.files?.[0]; e.target.value = ''; if (chosen) void upload(chosen); }} />
      <Button variant="primary" disabled={!!busy} onClick={() => file.current?.click()}><Upload size={17} />Choose a PDF</Button>
      {busy && <p className="muted" role="status">{busy}</p>}
      {notice && <p className="muted" role="status">{notice}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <p className="muted small-copy">The PDF becomes an editable draft before it can affect your workouts.</p>
    </section>

    {imports.length > 0 && <section className="panel">
      <div className="section-heading"><h2>Your imports</h2><span className="muted">{imports.length}</span></div>
      {imports.map(view => <Button key={view.id} variant="tertiary" className={`history-row ${selected?.id === view.id ? 'selected' : ''}`} onClick={() => { setError(''); setSelected(view); }}>
        <span className="exercise-icon"><FileText size={19} /></span><span className="row-title"><strong>{view.fileName}</strong>
          <small>{new Date(view.created).toLocaleString()} · {statusLabel(view.status)}{view.stage !== 'done' ? ` · ${view.chunksDone}/${view.chunksTotal} chunks` : ''}{view.error ? ` · ${view.error}` : ''}</small></span>
        {view.status === 'ready' && <span className="tiny-label">{view.unresolvedCount ? `${view.unresolvedCount} unmapped` : 'Ready'}</span>}
      </Button>)}
    </section>}

    {selected && selected.status === 'pending' && <section className="panel">
      {selected.stage === 'select' && selected.alternatives?.length ? <div className="empty-message"><Wand2 size={30} /><h3>Choose a program</h3>
        <p>This PDF contains several programs. Choose one before detailed extraction; its consecutive phases will stay together.</p>
        <div className="settings-actions">{selected.alternatives.map(alternative => <Button key={alternative.id} variant="primary" disabled={!!busy} onClick={() => act('Selecting program…', async () => { const view = await api.selectImportAlternative(selected.id, alternative.id); setSelected(view); setDraft(view.draft); if (view.stage === 'extract') await continueExtraction(view, selectedFile.current ?? new File([], view.fileName)); })}>{alternative.name} · {alternative.dayCount} days</Button>)}</div>
      </div> : <div className="empty-message"><Wand2 size={30} /><h3>Extraction paused</h3>
        <p>{selected.chunksDone} of {selected.chunksTotal} chunks are complete. Extraction can continue from the server; select the PDF only if its temporary source has expired.</p>
        {selected.error && <p className="error-text">Last chunk: {selected.error}</p>}
        <Button variant="primary" onClick={() => void act('Continuing extraction…', async () => {
          const view = await api.retryImport(selected.id);
          setSelected(view); setDraft(view.draft);
          if (view.stage === 'extract') await continueExtraction(view, selectedFile.current ?? new File([], view.fileName));
        })} disabled={!!busy}>Continue saved extraction</Button>
        <Button variant="primary" onClick={() => file.current?.click()} disabled={!!busy}><Upload size={16} />Choose the same PDF to continue</Button>
      </div>}
    </section>}

    {selected && draft && selected.status === 'ready' && <>
      <section className="panel">
        <div className="section-heading"><h2>Review</h2></div>
        <Field label="Program name" name="import-program-name" value={draft.programName} onChange={e => setDraft({ ...draft, programName: e.target.value })} onBlur={() => void persist(draft)} />
        <TextAreaField label="Description" name="import-description" value={draft.description ?? ''} onChange={e => setDraft({ ...draft, description: e.target.value })} onBlur={() => void persist(draft)} />
        {selected.unresolved.length > 0 && <div className="error-banner" role="status"><AlertTriangle size={17} />
          {selected.unresolved.length} exercise name{selected.unresolved.length === 1 ? '' : 's'} are not linked to the catalog. They will stay verbatim and can still be logged.
        </div>}
        {!!selected.reviewIssues?.length && <div className="notice-list" role="status">
          {selected.reviewIssues.map((issue, index) => <p key={`${issue.code}-${index}`} className={issue.severity === 'blocking' ? 'error-text' : 'muted'}>
            <AlertTriangle size={14} /> {issue.message}{issue.sourcePage ? ` (PDF p.${issue.sourcePage})` : ''}
          </p>)}
        </div>}
        {(selected.model || selected.inputTokens || selected.outputTokens || selected.pageCoverage?.length || selected.visualFallbacks || selected.retries) ? <details className="import-details">
          <summary>Import details <ChevronDown size={14} /></summary>
          <div className="import-details-body">
            {selected.model && <p>Model: {selected.model}</p>}
            {selected.pageCoverage?.length ? <p>{selected.pageCoverage.filter(page => page.hasText).length} of {selected.pageCoverage.length} pages have selectable text.</p> : null}
            {(selected.inputTokens || selected.outputTokens) ? <p>Usage: {selected.inputTokens ?? 0} input · {selected.outputTokens ?? 0} output tokens.</p> : null}
            {selected.visualFallbacks ? <p>{selected.visualFallbacks} visual pass{selected.visualFallbacks === 1 ? '' : 'es'} used.</p> : null}
            {selected.retries ? <p>{selected.retries} retr{selected.retries === 1 ? 'y' : 'ies'} recorded.</p> : null}
          </div>
        </details> : null}
      </section>
      {draft.workouts.length > 0 ? <DraftOutline draft={draft} expandedDay={expandedDay} setExpandedDay={setExpandedDay} exercises={exercises} onDayChange={persistDay} />
        : <section className="panel"><div className="empty-message"><AlertTriangle size={30} /><h3>No extracted days</h3><p>The draft needs at least one training or rest day.</p></div></section>}
      <section className="panel"><div className="settings-actions">
        <Button disabled={!!busy} onClick={() => act('rematch', async () => { const view = await api.rematchImport(selected.id); setSelected(view); setDraft(view.draft); })}><Wand2 size={17} />Match against the library again</Button>
        <Button variant="destructive" disabled={!!busy} onClick={() => act('discard', async () => { await api.discardImport(selected.id); setSelected(null); setDraft(null); })}><Trash2 size={17} />Discard draft</Button>
        <Button variant="primary" disabled={!!busy || !selected.acceptable || (requiresAcknowledgement && !acknowledgeUnspecified)} onClick={() => act('accept', async () => { await api.acceptImport(selected.id, acknowledgeUnspecified); setSelected(null); setDraft(null); onBack(); })}><Check size={17} />Accept and create program</Button>
      </div>{requiresAcknowledgement && <label className="checkbox-field"><input type="checkbox" checked={acknowledgeUnspecified} onChange={event => setAcknowledgeUnspecified(event.target.checked)} />I acknowledge that the PDF did not state every working-set RPE or rest value; those remain unspecified.</label>}<p className="muted small-copy">Catalog matches are helpful but optional; unmapped names are preserved exactly.</p></section>
    </>}

    {selected && selected.status === 'failed' && <section className="panel"><div className="empty-message"><AlertTriangle size={30} /><h3>Import failed</h3><p>{selected.error}</p><p className="muted">The original PDF was not kept, so upload it again.</p></div></section>}
  </>;
}

function DraftOutline({ draft, expandedDay, setExpandedDay, exercises, onDayChange }: { draft: ImportDraft; expandedDay: string | null; setExpandedDay: (id: string | null) => void; exercises: Exercise[]; onDayChange: (day: DraftWorkout) => Promise<void> }) {
  const blocks = new Map<string, Map<string, Map<number, DraftWorkout[]>>>();
  for (const day of draft.workouts) {
    const block = day.block || 'Program'; const phase = day.phase || 'General';
    if (!blocks.has(block)) blocks.set(block, new Map());
    const phases = blocks.get(block)!; if (!phases.has(phase)) phases.set(phase, new Map());
    const weeks = phases.get(phase)!; if (!weeks.has(day.phaseWeek)) weeks.set(day.phaseWeek, []); weeks.get(day.phaseWeek)!.push(day);
  }
  return <div className="import-tree">{[...blocks].map(([block, phases]) => <section className="panel" key={block}>
    <div className="section-heading"><h2>{block}</h2><span className="tiny-label">Block</span></div>
    {[...phases].map(([phase, weeks]) => <details className="phase-tree" key={phase} open><summary><ChevronDown size={15} />{phase}</summary>
      {[...weeks].map(([week, days]) => <div className="week-tree" key={week}><div className="tiny-label accent">Week {week}</div>
        {days.map(day => <DayRow key={day.lineId} day={day} expanded={expandedDay === day.lineId} onToggle={() => setExpandedDay(expandedDay === day.lineId ? null : day.lineId)} exercises={exercises} onChange={onDayChange} />)}
      </div>)}
    </details>)}
  </section>)}</div>;
}

function DayRow({ day, expanded, onToggle, exercises, onChange }: { day: DraftWorkout; expanded: boolean; onToggle: () => void; exercises: Exercise[]; onChange: (day: DraftWorkout) => Promise<void> }) {
  return <section className={`draft-day ${day.isRestDay ? 'rest-day' : ''}`}>
    <Button presentation="plain" className="draft-day-summary" aria-expanded={expanded} onClick={onToggle}>
      <span><strong>W{day.phaseWeek} · {day.name}</strong><small>{day.isRestDay ? 'Rest day' : `${day.exercises.length} exercises`}{day.phase?.toLowerCase().includes('deload') ? ' · Deload' : ''}{day.sourcePage ? ` · PDF p.${day.sourcePage}` : ''}</small></span>
      <span className="tiny-label">{day.isRestDay ? 'Rest day' : expanded ? 'Close' : 'Edit'}</span>
    </Button>
    {expanded && <DayEditor day={day} exercises={exercises} onChange={onChange} />}
  </section>;
}

function DayEditor({ day, exercises, onChange }: { day: DraftWorkout; exercises: Exercise[]; onChange: (day: DraftWorkout) => Promise<void> }) {
  const [draft, setDraft] = useState(day);
  useEffect(() => setDraft(day), [day]);
  const save = (next: DraftWorkout) => { setDraft(next); void onChange(next); };
  const groups: DraftExercise[][] = [];
  for (const exercise of draft.exercises) {
    const prefix = exercise.sequenceGroup?.trim().match(/^[A-Za-z]+/)?.[0] ?? '';
    const previous = groups.at(-1)?.[0]?.sequenceGroup?.match(/^[A-Za-z]+/)?.[0] ?? '';
    if (prefix && prefix === previous) groups.at(-1)!.push(exercise); else groups.push([exercise]);
  }
  return <div className="day-editor">
    <Field label="Day name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} onBlur={() => void onChange(draft)} />
    <TextAreaField label="Notes" value={draft.notes ?? ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} onBlur={() => void onChange(draft)} />
    <SelectField label="Weekday" aria-label="Workout weekday" value={draft.weekday ?? ''} onChange={e => save({ ...draft, weekday: e.target.value ? Number(e.target.value) : null })}>
      <option value="">Unspecified — choose when scheduling</option>{weekdayNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
    </SelectField>
    {draft.isRestDay ? <div className="rest-callout"><span className="tiny-label">Rest day</span><p>No exercises are scheduled for this slot.</p></div> : groups.map((group, groupIndex) => <div className={group.length > 1 ? 'superset-block' : ''} key={groupIndex}>
      {group.length > 1 && <div className="superset-heading">Superset {group[0].sequenceGroup.match(/^[A-Za-z]+/)?.[0] ?? ''}</div>}
      {group.map(exercise => <ExerciseEditor key={exercise.lineId} exercise={exercise} exercises={exercises} onChange={next => save({ ...draft, exercises: draft.exercises.map(item => item.lineId === next.lineId ? next : item) })} />)}
    </div>)}
    {!draft.isRestDay && <Button variant="tertiary" onClick={() => save({ ...draft, exercises: [...draft.exercises, blankExercise()] })}><Plus size={16} />Add exercise</Button>}
  </div>;
}

function ExerciseEditor({ exercise, exercises, onChange }: { exercise: DraftExercise; exercises: Exercise[]; onChange: (exercise: DraftExercise) => void }) {
  const editSet = (index: number, patch: Partial<DraftSet>) => onChange({ ...exercise, sets: exercise.sets.map((set, i) => i === index ? { ...set, ...patch } : set) });
  return <div className="import-exercise">
    <div className="section-heading"><div><input className="inline-input" aria-label={`Exercise name as written in the PDF`} value={exercise.sourceName} onChange={e => onChange({ ...exercise, sourceName: e.target.value })} />
      {exercise.sourcePage && <span className="tiny-label">PDF p.{exercise.sourcePage}</span>}
      {!exercise.exerciseId && <span className="tiny-label warn"><AlertTriangle size={12} /> Unmapped · preserved</span>}</div></div>
    <div className="import-fields"><label className="field">Library exercise<select aria-label={`Library exercise for ${exercise.sourceName}`} value={exercise.exerciseId ?? ''} onChange={e => onChange({ ...exercise, exerciseId: e.target.value || null })}>
      <option value="">Not mapped</option>{exercises.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select></label><label className="field">Superset group<input value={exercise.sequenceGroup} onChange={e => onChange({ ...exercise, sequenceGroup: e.target.value })} placeholder="A1" /></label>
      <label className="field">Substitutions<input value={exercise.substitutions.join(', ')} onChange={e => onChange({ ...exercise, substitutions: e.target.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 2) })} placeholder="Optional alternates" /></label></div>
    {exercise.notes && <p className="note-block">{exercise.notes}</p>}
    <div className="set-table import-set-table"><div className="set-table-head"><span>Set</span><span>Reps</span><span>RPE/RIR</span><span>%1RM</span><span>Rest</span><span>Source</span><span /></div>
      {exercise.sets.map((set, i) => <div className={`set-row ${set.warmup ? 'warmup-row' : ''}`} key={i}><span className="set-number">{set.warmup ? `W${i + 1}` : i + 1}</span>
        <div className="set-fields">
          <label className="set-field"><span>Reps</span><input aria-label={`Set ${i + 1} reps text`} value={set.repsText ?? showReps(set)} onChange={e => editSet(i, { repsText: e.target.value, repsSource: 'userEdited' })} /></label>
          <label className="set-field"><span>RPE/RIR</span><input aria-label={`Set ${i + 1} target RPE`} inputMode="decimal" type="number" value={set.targetRpe ?? ''} onChange={e => editSet(i, { targetRpe: e.target.value === '' ? null : Number(e.target.value), rpeSource: 'userEdited' })} /></label>
          <label className="set-field"><span>%1RM</span><input aria-label={`Set ${i + 1} percent 1RM`} value={set.percent1Rm ?? ''} onChange={e => editSet(i, { percent1Rm: e.target.value })} /></label>
          <label className="set-field"><span>Rest</span><input aria-label={`Set ${i + 1} rest text`} value={set.restText ?? (set.restSeconds === null ? '' : `${set.restSeconds}s`)} onChange={e => editSet(i, { restText: e.target.value, restSource: 'userEdited' })} /></label>
        </div>
        <span className="source-cell"><Source source={set.repsSource} />{set.rpeSource !== set.repsSource && <Source source={set.rpeSource} />}</span>
        <div className="set-actions"><Button variant="tertiary" aria-label={`Remove set ${i + 1}`} onClick={() => onChange({ ...exercise, sets: exercise.sets.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button></div>
      </div>)}
    </div>
    <Button variant="tertiary" disabled={exercise.sets.length >= 24} onClick={() => onChange({ ...exercise, sets: [...exercise.sets, { ...exercise.sets.at(-1)!, warmup: false, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }] })}><Plus size={15} />Add set</Button>
  </div>;
}

function blankExercise(): DraftExercise {
  return { lineId: crypto.randomUUID(), sourceName: 'New exercise', exerciseId: null, notes: null, sequenceGroup: '', substitutions: [], sets: [blankSet()] };
}

function blankSet(): DraftSet {
  return { repMin: 8, repMax: 12, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited', repsText: null, restText: null, percent1Rm: null, rir: null, warmup: false };
}
