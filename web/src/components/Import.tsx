import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Trash2, Upload, Wand2, X } from 'lucide-react';
import type { DraftWorkout, Exercise, ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { validateDraftWorkout, validateImportMetadata } from '../lib/validation';
import { Button } from './ui/Button';
import { Field, TextAreaField } from './ui/Field';
import { DraftOutline } from './ImportDraftTree';
import { useImportPipeline, type ImportFailure, type ImportProgress } from './useImportPipeline';

function stageLabel(view: ImportView) {
  if (view.stage === 'outline') return 'Reading the outline';
  if (view.stage === 'select') return 'Waiting for your choice';
  if (view.stage === 'extract') return `Section ${Math.min(view.chunksDone + 1, view.chunksTotal)} of ${view.chunksTotal}`;
  return 'Reading';
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

export function ImportReview({ exercises, imports, remaining, onBack, onChanged }: {
  exercises: Exercise[]; imports: ImportView[]; remaining: number; onBack: () => void; onChanged: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<ImportView | null>(imports.find(i => i.status === 'ready') ?? imports[0] ?? null);
  const [draft, setDraft] = useState<ImportDraft | null>(selected?.draft ?? null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [saving, setSaving] = useState('');
  const [saveError, setSaveError] = useState('');
  const [acknowledgeUnspecified, setAcknowledgeUnspecified] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const pipeline = useImportPipeline({ setSelected, setDraft, onChanged });
  const busy = pipeline.busy || !!saving;

  useEffect(() => {
    let cancelled = false;
    setAcknowledgeUnspecified(false);
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
    const invalid = validateImportMetadata(next.programName, next.description);
    if (invalid) { setSaveError(invalid); return; }
    setSaving('Saving your changes…'); setSaveError('');
    try { const view = await api.editImport(selected.id, { programName: next.programName, description: next.description }); setSelected(view); setDraft(view.draft); await onChanged(); }
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

  const requiresAcknowledgement = !!selected?.reviewIssues?.some(issue => issue.code === 'rpe_unspecified' || issue.code === 'rest_unspecified');
  // A stored expiry is the server's own statement that it still holds this document's text and
  // can continue the read without extracting it again.
  const serverHoldsSource = !!selected?.sourceExpiresAt;

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
      <Button variant="primary" disabled={busy} onClick={() => file.current?.click()}><Upload size={17} />Choose a PDF</Button>
      {pipeline.progress && <Progress progress={pipeline.progress} />}
      {saving && <p className="muted" role="status">{saving}</p>}
      {pipeline.notice && <p className="muted" role="status">{pipeline.notice}</p>}
      {pipeline.failure && <Failure failure={pipeline.failure} onChooseFile={() => file.current?.click()} onDismiss={pipeline.clearFailure}
        onRetry={selected && selected.status === 'pending' && serverHoldsSource ? () => void pipeline.resume(selected) : undefined} />}
      {saveError && <p className="error-text" role="alert">{saveError}</p>}
      <p className="muted small-copy">The text is read from the PDF on this device and only that text is sent; the file itself stays here. It becomes an editable draft before it can affect your workouts.</p>
    </section>

    {selected && selected.status === 'pending' && <section className="panel">
      {selected.stage === 'select' && selected.alternatives?.length ? <div className="empty-message"><Wand2 size={30} /><h3>Choose a program</h3>
        <p>This PDF contains several programs. Choose one before detailed extraction; its consecutive phases will stay together.</p>
        <div className="settings-actions">{selected.alternatives.map(alternative => <Button key={alternative.id} variant="primary" disabled={busy}
          onClick={() => void pipeline.chooseAlternative(selected, alternative.id)}>{alternative.name} · {alternative.dayCount} days</Button>)}</div>
      </div> : <div className="empty-message"><Wand2 size={30} /><h3>{stageLabel(selected)}</h3>
        <p>{serverHoldsSource
          ? 'The text from this PDF is saved for a day, so you can continue this read now or come back to it later. Nothing already read is lost.'
          : 'The saved text from this PDF has expired. Choose the file again to read it from the start.'}</p>
        {selected.chunksTotal > 0 && <Progress progress={{
          label: stageLabel(selected), detail: selected.currentChunkLabel ?? '',
          percent: Math.round((selected.chunksDone / selected.chunksTotal) * 100)
        }} />}
        {selected.error && <p className="error-text">Last attempt: {selected.error}</p>}
        <div className="settings-actions">
          {serverHoldsSource && <Button variant="primary" disabled={busy} onClick={() => void pipeline.resume(selected)}>Continue now</Button>}
          <Button variant={serverHoldsSource ? 'secondary' : 'primary'} disabled={busy} onClick={() => file.current?.click()}><Upload size={16} />Choose the PDF again</Button>
        </div>
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
      {draft.workouts.length > 0 ? <DraftOutline draft={draft} expandedDay={expandedDay} setExpandedDay={setExpandedDay} exercises={exercises} onDayChange={persistDay} />
        : <section className="panel"><div className="empty-message"><AlertTriangle size={30} /><h3>No extracted days</h3><p>The draft needs at least one training or rest day.</p></div></section>}
      <section className="panel"><div className="settings-actions">
        <Button disabled={busy} onClick={() => pipeline.run('Matching against the library…', async () => { const view = await api.rematchImport(selected.id); setSelected(view); setDraft(view.draft); })}><Wand2 size={17} />Match against the library again</Button>
        <Button variant="destructive" disabled={busy} onClick={() => pipeline.run('Discarding this draft…', async () => { await api.discardImport(selected.id); setSelected(null); setDraft(null); })}><Trash2 size={17} />Discard draft</Button>
        <Button variant="primary" disabled={busy || !selected.acceptable || (requiresAcknowledgement && !acknowledgeUnspecified)} onClick={() => pipeline.run('Creating the program…', async () => { await api.acceptImport(selected.id, acknowledgeUnspecified); setSelected(null); setDraft(null); onBack(); })}><Check size={17} />Accept and create program</Button>
      </div>{requiresAcknowledgement && <label className="checkbox-field"><input type="checkbox" checked={acknowledgeUnspecified} onChange={event => setAcknowledgeUnspecified(event.target.checked)} />I acknowledge that the PDF did not state every working-set RPE or rest value; those remain unspecified.</label>}<p className="muted small-copy">Catalog matches are helpful but optional; unmapped names are preserved exactly.</p></section>
    </>}

    {selected && selected.status === 'failed' && <section className="panel"><div className="empty-message"><AlertTriangle size={30} /><h3>Import failed</h3><p>{selected.error}</p><p className="muted">Nothing from that read was kept, so choose the PDF again.</p>
      <Button variant="primary" disabled={busy} onClick={() => file.current?.click()}><Upload size={16} />Choose the PDF again</Button></div></section>}
  </>;
}
