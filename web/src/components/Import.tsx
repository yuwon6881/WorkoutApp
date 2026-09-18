import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Loader2, Trash2, Upload, Wand2, X } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { validateDraftWorkout, validateName } from '../lib/validation';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { DraftOutline, type DraftOutlineHandle, type ImportIssueTarget } from './ImportDraftTree';
import { useImportPipeline, type ImportFailure, type ImportProgress } from './useImportPipeline';

/// What the import is doing. A read in flight covers every section the import still owes, because
/// they are sent together rather than one after another, so it says how many are being read; a
/// resting import names the section that commits next instead.
function stageLabel(view: ImportView, reading = false) {
  if (view.stage === 'outline') return 'Reading the outline';
  if (view.stage === 'select') return 'Waiting for your choice';
  if (view.stage !== 'extract') return 'Reading';
  const remaining = Math.max(0, view.chunksTotal - view.chunksDone);
  if (!reading) return `Section ${Math.min(view.chunksDone + 1, view.chunksTotal)} of ${view.chunksTotal}`;
  return remaining > 1 ? `Reading ${remaining} sections at once` : 'Reading the last section';
}

/// One honest progress reading. A step with no measurable size stays indeterminate rather than
/// showing a number the app cannot stand behind.
function Progress({ progress }: { progress: ImportProgress }) {
  return <div className="import-progress" role="status" aria-live="polite">
    <div className="import-progress-line">
      <span className="import-progress-label">{progress.label}</span>
      {progress.percent !== null && <span className="import-progress-percent">{progress.percent}%</span>}
    </div>
    <div className={`import-progress-track ${progress.percent === null ? 'indeterminate' : ''}`}
      role="progressbar" aria-label={progress.label}
      aria-valuenow={progress.percent ?? undefined} aria-valuemin={progress.percent === null ? undefined : 0} aria-valuemax={progress.percent === null ? undefined : 100}>
      <div className="import-progress-fill" style={progress.percent === null ? undefined : { width: `${progress.percent}%` }} />
    </div>
    {progress.detail && <small>{progress.detail}</small>}
  </div>;
}

/// Every import failure carries the one action that clears it, so the message is never a dead end.
function Failure({ failure, onChooseFile, onRetry, onDismiss }: {
  failure: ImportFailure; onChooseFile: () => void; onRetry?: () => void; onDismiss: () => void;
}) {
  return <div className="error-banner" role="alert">
    <AlertTriangle size={17} />
    <span className="import-failure-message">{failure.message}</span>
    <div className="import-failure-actions">
      {onRetry
        ? <Button variant="primary" onClick={onRetry}>Try again</Button>
        : <Button variant="primary" onClick={onChooseFile}><Upload size={15} />Choose a PDF</Button>}
      <Button variant="tertiary" aria-label="Dismiss this message" onClick={onDismiss}><X size={15} /></Button>
    </div>
  </div>;
}

export function ImportReview({ exercises, imports, remaining, onBack, onChanged, notify }: {
  exercises: Exercise[]; imports: ImportView[]; remaining: number; onBack: () => void; onChanged: () => Promise<void>; notify?: (message: string) => void;
}) {
  const [selected, setSelected] = useState<ImportView | null>(imports.find(i => i.status === 'ready') ?? imports[0] ?? null);
  const [draft, setDraft] = useState<ImportDraft | null>(selected?.draft ?? null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [saving, setSaving] = useState('');
  const [saveError, setSaveError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const outlineRef = useRef<DraftOutlineHandle>(null);

  const handleComplete = useCallback((count: number) => {
    notify?.(`Import complete! Read ${count} workout days. Review your program below.`);
    if (typeof document !== 'undefined' && document.hidden) {
      const originalTitle = document.title;
      document.title = '✓ Import complete! — Workout';
      const onFocus = () => {
        document.title = originalTitle;
        window.removeEventListener('focus', onFocus);
      };
      window.addEventListener('focus', onFocus);
    }
    window.setTimeout(() => {
      reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }, [notify]);

  const pipeline = useImportPipeline({ selected, setSelected, setDraft, onChanged, onComplete: handleComplete });
  const busy = pipeline.busy || !!saving;

  useEffect(() => {
    let cancelled = false;
    if (!selected) { setDraft(null); return; }
    if (selected.draft) { setDraft(selected.draft); return; }
    api.getImport(selected.id).then(view => {
      if (!cancelled) { setSelected(view); setDraft(view.draft); }
    }).catch(failure => { if (!cancelled) setSaveError(failure instanceof ApiError ? failure.message : 'Could not load this import.'); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  async function persist(next: ImportDraft) {
    if (!selected) return;
    setDraft(next);
    const invalid = validateName(next.programName, 'Program name');
    if (invalid) { setSaveError(invalid); return; }
    setSaving('Saving your changes…'); setSaveError('');
    try { const view = await api.editImport(selected.id, { programName: next.programName }); setSelected(view); setDraft(view.draft); await onChanged(); }
    catch (failure) { setSaveError(failure instanceof ApiError ? failure.message : 'Could not save your changes.'); }
    finally { setSaving(''); }
  }

  async function persistDay(day: DraftWorkout) {
    if (!selected) return;
    setDraft(current => current ? { ...current, workouts: current.workouts.map(item => item.lineId === day.lineId ? day : item) } : current);
    const invalid = validateDraftWorkout(day);
    if (invalid) { setSaveError(invalid); return; }
    setSaving('Saving this day…'); setSaveError('');
    try { const view = await api.editImportDay(selected.id, day); setSelected(view); setDraft(view.draft); await onChanged(); }
    catch (failure) { setSaveError(failure instanceof ApiError ? failure.message : 'Could not save this day.'); }
    finally { setSaving(''); }
  }

  // A stored expiry is the server's own statement that it still holds this document's text and
  // can continue the read without extracting it again.
  const serverHoldsSource = !!selected?.sourceExpiresAt;
  const reviewIssues = selected?.reviewIssues ?? [];
  const unresolved = selected?.unresolved ?? [];

  function unresolvedTarget(lineId: string): ImportIssueTarget {
    const day = draft?.workouts.find(candidate => candidate.exercises.some(exercise => exercise.lineId === lineId));
    return { workoutLineId: day?.lineId, exerciseLineId: lineId, targetField: 'library' };
  }

  function focusReviewIssue(target: ImportIssueTarget) {
    outlineRef.current?.focusIssue(target);
  }

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
      <div className="section-heading"><h2>Upload</h2><span className="muted">PDF · read on this device · up to 1,000 pages</span></div>
      <input name="program-pdf" ref={file} type="file" accept="application/pdf,.pdf" hidden aria-label="Program PDF"
        onChange={e => { const chosen = e.target.files?.[0]; e.target.value = ''; if (chosen) void pipeline.upload(chosen); }} />
      <div className="upload-action-row">
        <Button variant="primary" disabled={busy} onClick={() => file.current?.click()}><Upload size={17} />Choose a PDF</Button>
      </div>
      {pipeline.progress && <Progress progress={pipeline.progress} />}
      {saving && <p className="muted" role="status">{saving}</p>}
      {pipeline.notice && <p className="muted" role="status">{pipeline.notice}</p>}
      {pipeline.failure && <Failure failure={pipeline.failure} onChooseFile={() => file.current?.click()} onDismiss={pipeline.clearFailure}
        onRetry={selected && selected.status === 'pending' && serverHoldsSource ? () => void pipeline.resume(selected) : undefined} />}
      {saveError && <p className="error-text" role="alert">{saveError}</p>}
      <p className="muted small-copy">The text is read from the PDF on this device and only that text is sent; the file itself stays here. It becomes an editable draft before it can affect your workouts.</p>
    </section>

    {selected && selected.status === 'pending' && <section className="panel import-reading-panel">
      {selected.stage === 'select' && selected.alternatives?.length ? <div className="empty-message"><Wand2 size={24} /><h3>Choose a program</h3>
        <p>This PDF contains several programs. Choose one before detailed extraction; its consecutive phases will stay together.</p>
        <div className="settings-actions">{selected.alternatives.map(alternative => <Button key={alternative.id} variant="primary" disabled={busy}
          onClick={() => void pipeline.chooseAlternative(selected, alternative.id)}>{alternative.name} · {alternative.dayCount} days</Button>)}</div>
      </div> : <div className="import-reading-card">
        <div className="reading-card-header">
          <div className="reading-card-title">
            {busy ? <Loader2 size={18} className="spin accent" /> : <Wand2 size={18} className="accent" />}
            <h3>{busy ? 'Reading PDF…' : stageLabel(selected)}</h3>
          </div>
          <span className="pill pill-accent">{serverHoldsSource ? 'Saved for 24h' : 'Expired'}</span>
        </div>
        <p className="muted small-copy">{serverHoldsSource
          ? 'The text from this PDF is saved for a day, so you can continue this read now or come back to it later. Nothing already read is lost.'
          : 'The saved text from this PDF has expired. Choose the file again to read it from the start.'}</p>
        {/* The bar measures what has committed, which is the only part of a read that is finished.
            While sections are in flight it names none of them: they are all being read, and they
            commit in outline order as they land. */}
        {selected.chunksTotal > 0 && <Progress progress={{
          label: stageLabel(selected, busy),
          detail: busy && selected.chunksTotal - selected.chunksDone > 1
            ? 'Sections commit in order as they land.'
            : selected.currentChunkLabel ?? '',
          percent: Math.round((selected.chunksDone / selected.chunksTotal) * 100)
        }} />}
        {selected.error && <p className="error-text">Last attempt: {selected.error}</p>}
        <div className="reading-card-actions">
          {serverHoldsSource && <Button variant="primary" disabled={busy} onClick={() => void pipeline.resume(selected)}><Wand2 size={15} />Continue now</Button>}
          <Button variant={serverHoldsSource ? 'secondary' : 'primary'} disabled={busy} onClick={() => file.current?.click()}><Upload size={15} />Choose the PDF again</Button>
          {/* Cancelling stays available while a read is out: that is exactly when someone realises
              they picked the wrong file and wants a clean start. */}
          <Button variant="destructive" onClick={() => void pipeline.cancel(selected)}><Trash2 size={15} />Cancel import</Button>
        </div>
      </div>}
    </section>}

    {selected && draft && selected.status === 'ready' && <>
      <section className="panel" ref={reviewRef}>
        <div className="section-heading"><h2>Review</h2></div>
        <Field label="Program name" name="import-program-name" value={draft.programName} onChange={e => setDraft({ ...draft, programName: e.target.value })} onBlur={() => void persist(draft)} />
        {selected.unresolved.length > 0 && <div className="error-banner" role="status"><AlertTriangle size={17} />
          {selected.unresolved.length} exercise name{selected.unresolved.length === 1 ? '' : 's'} are not linked to the catalog. They will stay verbatim and can still be logged.
        </div>}
        {(unresolved.length > 0 || reviewIssues.length > 0) && <section className="import-review-issues" aria-labelledby="import-review-issues-title">
          <div className="import-review-issues-heading">
            <div><h3 id="import-review-issues-title">Needs attention</h3><p>Resolve each item before creating the program.</p></div>
            <span className="pill">{unresolved.length + reviewIssues.length} {unresolved.length + reviewIssues.length === 1 ? 'item' : 'items'}</span>
          </div>
          <div className="import-issue-list" role="list">
            {unresolved.map(item => <div className="import-issue-list-item" role="listitem" key={`unresolved-${item.lineId}`}>
              <Button variant="tertiary" className="import-issue-card" aria-label={`Fix unmapped exercise ${item.sourceName}`} onClick={() => focusReviewIssue(unresolvedTarget(item.lineId))}>
                <AlertTriangle size={16} /><span><strong>Map {item.sourceName}</strong><small>Choose a library exercise for this slot.</small></span><ChevronDown size={16} />
              </Button>
            </div>)}
            {reviewIssues.map((issue, index) => <div className="import-issue-list-item" role="listitem" key={`${issue.code}-${index}`}>
              <Button variant="tertiary" className="import-issue-card" aria-label={`Fix issue: ${issue.message}`} onClick={() => focusReviewIssue({ sourcePage: issue.sourcePage, workoutLineId: issue.workoutLineId, exerciseLineId: issue.exerciseLineId, setIndex: issue.setIndex, targetField: issue.targetField })}>
                <AlertTriangle size={16} /><span><strong>{issue.message}</strong>{issue.sourcePage && <small>PDF p.{issue.sourcePage} · Open the related editor field.</small>}</span><ChevronDown size={16} />
              </Button>
            </div>)}
          </div>
        </section>}
        {(selected.model || selected.inputTokens || selected.outputTokens || selected.pageCoverage?.length || selected.retries) ? <details className="import-details">
          <summary>Import details <ChevronDown size={14} /></summary>
          <div className="import-details-body">
            {selected.model && <p>Model: {selected.model}</p>}
            {selected.pageCoverage?.length ? <p>{selected.pageCoverage.filter(page => page.hasText).length} of {selected.pageCoverage.length} pages have selectable text.</p> : null}
            {(selected.inputTokens || selected.outputTokens) ? <p>Usage: {selected.inputTokens ?? 0} input · {selected.outputTokens ?? 0} output tokens.</p> : null}
            {selected.retries ? <p>{selected.retries} retr{selected.retries === 1 ? 'y' : 'ies'} recorded.</p> : null}
          </div>
        </details> : null}
      </section>
      {draft.workouts.length > 0 ? <DraftOutline ref={outlineRef} draft={draft} expandedDay={expandedDay} setExpandedDay={setExpandedDay} exercises={exercises} onDayChange={persistDay} />
        : <section className="panel"><div className="empty-message"><AlertTriangle size={30} /><h3>No extracted days</h3><p>The draft needs at least one training or rest day.</p></div></section>}
      <section className="panel import-actions-panel">
        <div className="import-action-card-content">
          {!selected.acceptable && <p className="muted small-copy import-notice-copy" role="status">The program can be created after every review item is resolved.</p>}
        </div>
        <div className="import-actions-footer">
          <Button variant="destructive" disabled={busy} onClick={() => pipeline.run('Discarding this draft…', async () => { await api.discardImport(selected.id); setSelected(null); setDraft(null); })}><Trash2 size={17} />Discard draft</Button>
          <Button variant="primary" disabled={busy || !selected.acceptable} onClick={() => pipeline.run('Creating the program…', async () => { await api.acceptImport(selected.id); setSelected(null); setDraft(null); onBack(); })}><Check size={17} />Accept and create program</Button>
        </div>
      </section>
    </>}

    {selected && selected.status === 'failed' && <section className="panel"><div className="empty-message"><AlertTriangle size={30} /><h3>Import failed</h3><p>{selected.error}</p><p className="muted">Nothing from that read was kept, so choose the PDF again.</p>
      <Button variant="primary" disabled={busy} onClick={() => file.current?.click()}><Upload size={16} />Choose the PDF again</Button></div></section>}
  </>;
}
