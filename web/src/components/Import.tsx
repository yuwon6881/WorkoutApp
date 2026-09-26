import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ChevronRight, Loader2, RotateCcw, Trash2, Upload, Wand2, X } from 'lucide-react';
import type { Exercise, ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Modal } from './ui/Modal';
import { DraftOutline, type DraftOutlineHandle, type ImportIssueTarget } from './ImportDraftTree';
import { useImportPipeline, type ImportFailure, type ImportProgress } from './useImportPipeline';
import { useImportDraftSaver } from './useImportDraftSaver';
import './Import.css';

/// What the import is doing. A read in flight covers every section the import still owes, because
/// they are sent together rather than one after another, so it says how many are being read; a
/// resting import names the section that commits next instead.
function stageLabel(view: ImportView, reading = false) {
  if (view.stage === 'outline') return 'Reading the outline';
  if (view.stage === 'select') return 'Waiting for your choice';
  if (view.stage === 'verify') return 'Checking extracted details against the PDF';
  if (view.stage === 'recover') return 'Repairing source discrepancies';
  if (view.stage !== 'extract') return 'Reading';
  const remaining = Math.max(0, view.chunksTotal - view.chunksDone);
  if (!reading) return `Section ${Math.min(view.chunksDone + 1, view.chunksTotal)} of ${view.chunksTotal}`;
  return remaining > 1 ? `Reading ${remaining} sections at once` : 'Reading the last section';
}

/// One honest progress reading. A step with no measurable size stays indeterminate rather than
/// showing a number the app cannot stand behind.
function Progress({ progress, action }: { progress: ImportProgress; action?: React.ReactNode }) {
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
    {(progress.detail || action) && <div className="import-progress-footer">
      {progress.detail && <small>{progress.detail}</small>}
      {action && <div className="import-progress-actions">{action}</div>}
    </div>}
  </div>;
}

/// Every import failure carries the warning message that can be dismissed.
function Failure({ failure, onDismiss }: { failure: ImportFailure; onDismiss: () => void }) {
  return <div className="error-banner import-failure-banner" role="alert">
    <AlertTriangle size={17} />
    <span className="import-failure-message">{failure.message}</span>
    <div className="import-failure-actions">
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
  const [saveError, setSaveError] = useState('');
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [confirmRestoreDraft, setConfirmRestoreDraft] = useState(false);
  const [isRestoringDraft, setIsRestoringDraft] = useState(false);
  const [draftRestoreError, setDraftRestoreError] = useState<string | null>(null);
  const [alternativeChoice, setAlternativeChoice] = useState<string | null>(null);
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
  const saver = useImportDraftSaver({ selected, setSelected, draft, setDraft, onChanged, setSaveError });
  const busy = pipeline.busy || saver.pending;

  useEffect(() => {
    let cancelled = false;
    if (!selected) { setDraft(null); return; }
    if (selected.draft) { setDraft(selected.draft); return; }
    api.getImport(selected.id).then(view => {
      if (!cancelled) { setSelected(view); setDraft(view.draft); }
    }).catch(failure => { if (!cancelled) setSaveError(failure instanceof ApiError ? failure.message : 'Could not load this import.'); });
    return () => { cancelled = true; };
  }, [selected?.id]);

  useEffect(() => {
    setAlternativeChoice(selected?.stage === 'select' ? selected.selectedAlternativeId ?? null : null);
  }, [selected?.id, selected?.stage, selected?.selectedAlternativeId]);

  async function handleRestoreExercise(exerciseLineId: string) {
    await saver.mutate((view, revision) => api.restoreImportExercise(view.id, exerciseLineId, revision), 'Could not restore exercise.');
    notify?.('Exercise restored to default.');
  }

  async function mapExerciseSlot(exerciseLineId: string, exerciseId: string | null) {
    await saver.mutate((view, revision) => api.mapImportExerciseSlot(view.id, exerciseLineId, exerciseId, revision), 'Could not map this exercise slot.');
  }

  const reviewIssues = selected?.reviewIssues ?? [];
  const unresolved = selected?.unresolved ?? [];

  const attentionRows = [
    ...unresolved.map(item => ({
      key: `unresolved-${item.lineId}`,
      title: `Map ${item.sourceName} slot`,
      detail: `${item.block ? `${item.block} · ` : ''}${item.occurrences && item.occurrences > 1 ? `${item.occurrences} occurrences · ` : ''}Choose a library exercise for this slot.`,
      action: 'Map',
      ariaLabel: `Fix unmapped exercise ${item.sourceName}`,
      target: unresolvedTarget(item.lineId)
    })),
    ...reviewIssues.filter(issue => issue.severity !== 'info').map((issue, index) => ({
      key: `${issue.code}-${index}`,
      title: issue.message,
      detail: issue.sourcePage ? `PDF p.${issue.sourcePage} · Open the related editor field.` : 'Open the related editor field.',
      action: 'Fix',
      ariaLabel: `Fix issue: ${issue.message}`,
      target: { sourcePage: issue.sourcePage, workoutLineId: issue.workoutLineId, exerciseLineId: issue.exerciseLineId, setIndex: issue.setIndex, targetField: issue.targetField } as ImportIssueTarget
    }))
  ];
  const visibleAttentionRows = showAllIssues ? attentionRows : attentionRows.slice(0, 5);

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
      {/* Unified progress bar: covers PDF page reading, program detection, and server-side section
          extraction in one continuous bar rather than splitting across two panels. */}
      {pipeline.uploadProgress && <Progress progress={pipeline.uploadProgress} action={
        pipeline.uploadProgress.label === 'Reading the PDF on this device'
          ? <Button variant="secondary" onClick={pipeline.cancelUpload}><X size={15} />Cancel PDF reading</Button>
          : undefined
      } />}
      {!pipeline.uploadProgress && selected && selected.status === 'pending' && ['extract', 'verify', 'recover'].includes(selected.stage) && selected.chunksTotal > 0 && <Progress progress={{
        label: stageLabel(selected, busy),
        detail: selected.stage === 'verify'
          ? 'Comparing extracted sessions, exercises, sets, and prescriptions with printed source evidence.'
          : selected.stage === 'recover'
            ? 'Re-reading a section with a source discrepancy. Only source-supported corrections are applied.'
            : busy && selected.chunksTotal - selected.chunksDone > 1
              ? 'Sections commit in order as they land.'
              : selected.currentChunkLabel ?? '',
        percent: Math.round((selected.chunksDone / selected.chunksTotal) * 100)
      }} action={
        <Button variant="destructive" onClick={() => void pipeline.cancel(selected)}><Trash2 size={15} />Cancel import</Button>
      } />}
      {!pipeline.uploadProgress && selected && selected.status === 'pending' && selected.stage === 'outline' && <Progress progress={{
        label: 'Reading the outline',
        detail: selected.fileName,
        percent: null
      }} action={
        <Button variant="destructive" onClick={() => void pipeline.cancel(selected)}><Trash2 size={15} />Cancel import</Button>
      } />}
      {saver.pending && <p className="muted" role="status">Saving your changes…</p>}
      {pipeline.notice && <p className="muted" role="status">{pipeline.notice}</p>}
      {pipeline.failure && <Failure failure={pipeline.failure} onDismiss={pipeline.clearFailure} />}
      {saveError && <p className="error-text" role="alert">{saveError}</p>}
      <p className="muted small-copy">The text is read from the PDF on this device and only that text is sent; the file itself stays here. It becomes an editable draft before it can affect your workouts.</p>
    </section>

    {selected && selected.status === 'pending' && selected.stage === 'select' && selected.alternatives?.length ? <section className="panel import-reading-panel">
      <div className="empty-message"><Wand2 size={24} />{selected.alternatives.every(alternative => alternative.kind === 'week')
        ? <><h3>Choose a week version</h3>
          <p>This program prints a week in versions and asks you to run only one. Choose the version to import; the program is kept in order around it.</p></>
        : <><h3>Choose a program</h3>
          <p>This PDF contains several programs. Choose one before detailed extraction; its consecutive phases will stay together.</p></>}
        <div className="alternative-cards-grid" role="group" aria-label="Available program versions">
          {selected.alternatives.map(alternative => {
            const chosen = alternativeChoice === alternative.id;
            return (
              <article key={alternative.id} className={`alternative-card ${chosen ? 'selected' : ''}`}>
                <div className="alternative-card-body">
                  <h4 className="alternative-card-title">{alternative.name}</h4>
                  {alternative.description && <p className="alternative-card-description">{alternative.description}</p>}
                  <div className="alternative-card-meta">
                    {alternative.weekCount != null && <span className="pill pill-accent">{alternative.weekCount} week{alternative.weekCount === 1 ? '' : 's'}</span>}
                    {alternative.sessionsPerWeek != null && <span className="pill">{alternative.sessionsPerWeek} sessions / week</span>}
                    <span className="pill pill-muted">{alternative.kind === 'week'
                      ? `${alternative.dayCount} session${alternative.dayCount === 1 ? '' : 's'} in this version`
                      : `${alternative.dayCount} estimated sessions`}</span>
                  </div>
                </div>
                <div className="alternative-card-action">
                  <Button
                    variant={chosen ? 'primary' : 'secondary'}
                    disabled={busy}
                    className="alternative-select-btn"
                    aria-pressed={chosen}
                    onClick={() => setAlternativeChoice(alternative.id)}
                  >
                    {chosen ? 'Selected' : 'Choose this version'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="settings-actions alternative-selection-actions">
          <Button variant="primary" disabled={busy || !alternativeChoice}
            onClick={() => alternativeChoice && void pipeline.chooseAlternative(selected, alternativeChoice)}>
            Continue with selected version
          </Button>
        </div>
      </div>
    </section> : null}
    {selected && selected.status === 'pending' && selected.stage !== 'select' && selected.error && <section className="panel import-reading-panel">
      <div className="import-reading-card">
        <div className="reading-card-header">
          <div className="reading-card-title">
            <AlertTriangle size={18} className="red" />
            <h3>Reading stopped</h3>
          </div>
        </div>
        <div className="error-banner" role="alert"><AlertTriangle size={16} /><span>{selected.error}</span></div>
        <div className="reading-card-actions">
          <Button variant="primary" disabled={busy} onClick={() => void pipeline.resume(selected)}><RotateCcw size={15} />Retry reading</Button>
          <Button variant="destructive" onClick={() => void pipeline.cancel(selected)}><Trash2 size={15} />Cancel import</Button>
        </div>
      </div>
    </section>}

    {selected && draft && selected.status === 'ready' && <>
      <section className="panel" ref={reviewRef}>
        <div className="section-heading import-review-heading">
          <h2>Review</h2>
        </div>
        {!selected.acceptable && <p className="muted small-copy import-notice-copy" role="status">The program can be created after every review item is resolved.</p>}
        <Field label="Program name" name="import-program-name" value={draft.programName} onChange={e => setDraft({ ...draft, programName: e.target.value })} onBlur={() => void saver.persist(draft)} />
        {selected.unresolved.length > 0 && <div className="import-unresolved-banner" role="status"><AlertTriangle size={17} />
          <span>{selected.unresolved.length} exercise slot{selected.unresolved.length === 1 ? '' : 's'} are not linked to the catalog. Unmapped names stay verbatim and can still be logged.</span>
        </div>}
        {attentionRows.length > 0 && <section className="import-review-issues" aria-labelledby="import-review-issues-title">
          <div className="import-review-issues-heading">
            <div><h3 id="import-review-issues-title">Needs attention</h3><p className="muted">Resolve each item before creating the program.</p></div>
            <span className="pill pill-accent">{attentionRows.length} {attentionRows.length === 1 ? 'item' : 'items'}</span>
          </div>
          <div className="import-issue-table" role="table" aria-label="Import issues">
            <div className="import-issue-table-head" role="row">
              <span role="columnheader">Issue</span><span role="columnheader">Source</span><span role="columnheader">Action</span>
            </div>
            {visibleAttentionRows.map(row => <div className="import-issue-table-row" role="row" key={row.key}>
              <span className="import-issue-table-description" role="cell"><AlertTriangle size={15} /><strong>{row.title}</strong></span>
              <span className="import-issue-table-detail" role="cell">{row.detail}</span>
              <Button variant="secondary" className="import-issue-action-btn" aria-label={row.ariaLabel} onClick={() => focusReviewIssue(row.target)}>
                {row.action}<ChevronRight size={14} />
              </Button>
            </div>)}
          </div>
          {attentionRows.length > 5 && <div className="import-issue-table-footer">
            <span className="muted">Showing {visibleAttentionRows.length} of {attentionRows.length}</span>
            <Button variant="tertiary" onClick={() => setShowAllIssues(value => !value)}>{showAllIssues ? 'Show fewer' : `Show all ${attentionRows.length}`}</Button>
          </div>}
        </section>}
      </section>
      {draft.workouts.length > 0 ? (
        <DraftOutline
          ref={outlineRef}
          draft={draft}
          expandedDay={expandedDay}
          setExpandedDay={setExpandedDay}
          exercises={exercises}
          onDayChange={saver.persistDay}
          onDraftChange={saver.persist}
          onMapExerciseSlot={mapExerciseSlot}
          onCustomExerciseCreated={onChanged}
          restorableExerciseLineIds={selected.restorableExerciseLineIds}
          onRestoreExercise={handleRestoreExercise}
          canRestoreDraft={selected.canRestoreDraft || saver.localDirty}
          acceptable={selected.acceptable}
          busy={busy}
          onRestoreDraft={() => setConfirmRestoreDraft(true)}
          onDiscardDraft={() => pipeline.run('Discarding this draft…', async () => { await api.discardImport(selected.id); setSelected(null); setDraft(null); })}
          onAcceptProgram={() => pipeline.run('Creating the program…', async () => { await api.acceptImport(selected.id); setSelected(null); setDraft(null); onBack(); })}
        />
      )
        : <section className="panel"><div className="empty-message"><AlertTriangle size={30} /><h3>No extracted days</h3><p>The draft needs at least one training or rest day.</p></div></section>}
      {confirmRestoreDraft && <Modal title="Restore default draft" onClose={() => !isRestoringDraft && setConfirmRestoreDraft(false)}>
        <div className="modal-body" aria-busy={isRestoringDraft}>
          <p>Reset all exercises, mappings, notes, sets, and rep ranges across this entire program to the initial extracted version from the PDF?</p>
          <p className="muted small-copy">All manual adjustments made since extraction will be replaced with the default baseline.</p>
          {draftRestoreError && <p className="error-text" role="alert">{draftRestoreError}</p>}
        </div>
        <div className="modal-actions">
          <Button disabled={isRestoringDraft} onClick={() => setConfirmRestoreDraft(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={isRestoringDraft}
            aria-busy={isRestoringDraft}
            onClick={async () => {
              if (!selected) return;
              setIsRestoringDraft(true);
              setDraftRestoreError(null);
              try {
                await saver.flush();
                const view = await api.restoreImport(selected.id, saver.revision());
                saver.applyView(view);
                setConfirmRestoreDraft(false);
                notify?.('Draft restored to default extraction.');
              } catch (err) {
                setDraftRestoreError(err instanceof Error ? err.message : 'Could not restore default draft.');
              } finally {
                setIsRestoringDraft(false);
              }
            }}
          >
            {isRestoringDraft ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}
            {isRestoringDraft ? 'Restoring…' : 'Restore default draft'}
          </Button>
        </div>
      </Modal>}
    </>}

    {selected && selected.status === 'failed' && <section className="panel import-reading-panel" aria-labelledby="import-failed-title">
      <div className="import-reading-card">
        <div className="reading-card-header">
          <div className="reading-card-title"><AlertTriangle size={18} className="red" /><h3 id="import-failed-title">Import stopped</h3></div>
        </div>
        {selected.error && <div className="error-banner" role="alert"><AlertTriangle size={16} /><span>{selected.error}</span></div>}
        {selected.reviewIssues?.filter(issue => issue.severity !== 'info').map((issue, index) => <div className="import-failed-issue" key={`${issue.code}-${issue.sourcePage ?? 'source'}-${index}`}>
          <p>{issue.message}</p>
          {(issue.sourcePage || issue.targetField) && <small>{[issue.sourcePage ? `PDF p.${issue.sourcePage}` : null, issue.targetField].filter(Boolean).join(' · ')}</small>}
        </div>)}
        <div className="reading-card-actions">
          <Button variant="destructive" onClick={() => void pipeline.cancel(selected)}><Trash2 size={15} />Discard failed import</Button>
        </div>
      </div>
    </section>}
  </>;
}
