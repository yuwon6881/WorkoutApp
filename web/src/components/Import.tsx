import { useCallback, useEffect, useRef, useState } from 'react';
import type { Exercise, ImportDraft, ImportView } from '../types';
import { ApiError, api } from '../lib/api';
import { buildAttentionRows, type ImportIssueTarget } from '../lib/importAttentionRows';
import { resumableImport } from '../lib/importSelection';
import { localPdfRead, useLocalPdfRead } from '../lib/localPdfRead';
import { CardFeedback } from './ui/CardFeedback';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';
import { DraftOutline, type DraftOutlineHandle } from './ImportDraftTree';
import { useImportPipeline } from './useImportPipeline';
import { useImportDraftSaver } from './useImportDraftSaver';
import { ImportFailedPanel } from './ImportFailedPanel';
import { ImportFailureBanner } from './ImportFailureBanner';
import { ImportAlternatives } from './ImportAlternatives';
import { ImportProgressCard } from './ImportProgressCard';
import { ImportReadingStopped } from './ImportReadingStopped';
import { ImportRestoreDraftModal } from './ImportRestoreDraftModal';
import { ImportReviewPanel } from './ImportReviewPanel';
import { ImportUploadPanel } from './ImportUploadPanel';
import { StoppedImports } from './StoppedImports';
import './Import.css';
import './ImportReviewSurface.css';

function hasStructuredTerminalError(view: ImportView | null) {
  return Boolean(view?.error && view.reviewIssues?.some(issue => view.error.includes(`[${issue.code}]`)));
}

export function ImportReview({ exercises, imports, onBack, onChanged, notify }: {
  exercises: Exercise[]; imports: ImportView[]; onBack: () => void; onChanged: () => Promise<void>; notify?: (message: string) => void;
}) {
  const [selected, setSelected] = useState<ImportView | null>(() => localPdfRead() ? null : resumableImport(imports));
  const [draft, setDraft] = useState<ImportDraft | null>(selected?.draft ?? null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [confirmRestoreDraft, setConfirmRestoreDraft] = useState(false);
  const [alternativeChoice, setAlternativeChoice] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const outlineRef = useRef<DraftOutlineHandle>(null);

  const handleComplete = useCallback((count: number) => {
    notify?.(`Import complete! Read ${count} workout days. Review your program below.`);
    if (typeof document !== 'undefined' && document.hidden) {
      const originalTitle = document.title;
      document.title = 'Import complete — Workout';
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
  const localRead = useLocalPdfRead();
  /// Imports thrown away on this screen. The list prop is refreshed after a discard, so until it
  /// lands it can still carry the row that was just removed.
  const discarded = useRef(new Set<string>());

  // Discarding one import must not hide another that is still waiting for review: once the
  // screen is idle with nothing selected, it returns to the next live read or ready draft, the
  // same one it would open on a fresh visit. When imports update in the background, keep
  // the selected row in sync with its latest status and draft.
  useEffect(() => {
    if (busy || localRead || saver.localDirty) return;
    if (!selected) {
      const next = resumableImport(imports, discarded.current);
      if (next) setSelected(next);
      return;
    }
    const matching = imports.find(item => item.id === selected.id);
    // A list refresh started before the latest save may finish afterward. It must not move the
    // editor's revision backward or the next save will conflict with this device's own write.
    if (matching && matching.revision >= selected.revision &&
      (matching.status !== selected.status || matching.stage !== selected.stage || matching.revision !== selected.revision)) {
      setSelected(matching);
      if (matching.draft) setDraft(matching.draft);
    }
  }, [busy, imports, localRead, selected, saver.localDirty]);

  function discard(view: ImportView) {
    discarded.current.add(view.id);
    return pipeline.cancel(view);
  }

  useEffect(() => {
    let cancelled = false;
    if (!selected) { setDraft(null); return; }
    if (saver.localDirty) return;
    if (selected.draft) { setDraft(selected.draft); return; }
    if (selected.status === 'ready') {
      api.getImport(selected.id).then(view => {
        if (!cancelled) { setSelected(view); setDraft(view.draft); }
      }).catch(failure => { if (!cancelled) setSaveError(failure instanceof ApiError ? failure.message : 'Could not load this import.'); });
    }
    return () => { cancelled = true; };
  }, [selected?.id, selected?.status, selected?.draft]);

  useEffect(() => {
    setAlternativeChoice(selected?.stage === 'select' ? selected.selectedAlternativeId ?? null : null);
  }, [selected?.id, selected?.stage, selected?.selectedAlternativeId]);

  async function handleRestoreExercise(exerciseLineId: string) {
    await saver.mutate((view, revision) => api.restoreImportExercise(view.id, exerciseLineId, revision), 'Could not restore exercise.');
    notify?.('Exercise restored to default.');
  }

  const attentionRows = selected ? buildAttentionRows(selected, draft) : [];

  function focusReviewIssue(target: ImportIssueTarget) {
    outlineRef.current?.focusIssue(target);
  }

  // Any import in flight or open collapses the upload hero to the slim source bar, so the screen
  // shows one thing at a time instead of the hero above every state.
  const hasDraft = Boolean(selected);

  return <div className="import-page">
    <div className="page-heading">
      <div>
        <div className="back-nav-row">
          <Button variant="tertiary" className="back-button" onClick={onBack}><ArrowLeft size={16} />Back to workouts</Button>
        </div>
        <h1>Import a program</h1>
      </div>
    </div>

    <input name="program-pdf" ref={file} type="file" accept="application/pdf,.pdf" hidden aria-label="Program PDF"
      onChange={e => {
        const chosen = e.target.files?.[0];
        e.target.value = '';
        if (chosen) { setSaveError(''); void pipeline.upload(chosen); }
      }} />
    <ImportUploadPanel hasDraft={hasDraft} fileName={selected?.fileName} busy={busy} onChooseFile={() => file.current?.click()}
      footer={<StoppedImports imports={imports} busy={busy} onSelect={view => {
        pipeline.clearFailure();
        setSaveError('');
        setSelected(view);
        setDraft(view.draft);
      }} />}>
      <ImportProgressCard uploadProgress={pipeline.uploadProgress} selected={selected} busy={busy}
        onCancelUpload={pipeline.cancelUpload} onDiscard={view => void discard(view)} />
      {saver.pending && <p className="muted" role="status">Saving your changes…</p>}
      {pipeline.notice && <p className="muted" role="status">{pipeline.notice}</p>}
      {pipeline.failure && selected?.status !== 'failed'
        && !hasStructuredTerminalError(selected)
        && <ImportFailureBanner failure={pipeline.failure} onDismiss={pipeline.clearFailure} />}
      {saveError && <CardFeedback message={saveError} action={{ label: 'Retry save', disabled: busy,
        onClick: () => void saver.retry().catch(failure => setSaveError(failure instanceof Error ? failure.message : 'Could not save changes.')) }} />}
    </ImportUploadPanel>

    {selected && selected.status === 'pending' && selected.stage === 'select' && selected.alternatives?.length
      ? <ImportAlternatives view={selected} choice={alternativeChoice} busy={busy} onChoose={setAlternativeChoice}
        onContinue={() => alternativeChoice && void pipeline.chooseAlternative(selected, alternativeChoice)} />
      : null}
    {selected && selected.status === 'pending' && selected.stage !== 'select' && selected.error
      && <ImportReadingStopped error={selected.error} busy={busy} onRetry={() => void pipeline.resume(selected)} onDiscard={() => void discard(selected)} />}

    {selected && !draft && selected.status === 'ready' && !selected.error && (
      <section className="panel" role="status">
        <div className="empty-message">
          <Loader2 size={24} className="spin" />
          <h3>Loading program draft…</h3>
          <p>Preparing the extracted days and exercises for review.</p>
        </div>
      </section>
    )}

    {selected && draft && selected.status === 'ready' && <>
      <ImportReviewPanel ref={reviewRef} view={selected} draft={draft} attentionRows={attentionRows}
        onNameChange={programName => saver.editLocal({ ...draft, programName })}
        onNameCommit={() => void saver.persist(draft)} onFocusIssue={focusReviewIssue} />
      {draft.workouts.length > 0 ? (
        <DraftOutline
          ref={outlineRef}
          draft={draft}
          expandedDay={expandedDay}
          setExpandedDay={setExpandedDay}
          exercises={exercises}
          onDayChange={saver.persistDay}
          onDraftChange={saver.persist}
          onExerciseChange={saver.persistExercise}
          onCustomExerciseCreated={onChanged}
          restorableExerciseLineIds={selected.restorableExerciseLineIds}
          onRestoreExercise={handleRestoreExercise}
          canRestoreDraft={selected.canRestoreDraft || saver.localDirty}
          acceptable={selected.acceptable && !saver.localDirty && !saveError}
          busy={busy}
          onRestoreDraft={() => setConfirmRestoreDraft(true)}
          onDiscardDraft={() => pipeline.run('Discarding this draft…', async () => { discarded.current.add(selected.id); await api.discardImport(selected.id); setSelected(null); setDraft(null); })}
          onAcceptProgram={() => pipeline.run('Creating the program…', async () => { await saver.flush(); await api.acceptImport(selected.id, saver.revision()); await onChanged(); setSelected(null); setDraft(null); onBack(); })}
        />
      )
        : <section className="panel"><div className="empty-message"><AlertTriangle size={30} /><h3>No extracted days</h3><p>The draft needs at least one training or rest day.</p></div></section>}
      {confirmRestoreDraft && <ImportRestoreDraftModal
        onClose={() => setConfirmRestoreDraft(false)}
        onRestore={async () => {
          await saver.flush(false);
          const view = await api.restoreImport(selected.id, saver.revision());
          saver.applyView(view);
          setConfirmRestoreDraft(false);
          notify?.('Draft restored to default extraction.');
        }} />}
    </>}

    {selected && selected.status === 'failed' && <ImportFailedPanel view={selected} busy={busy}
      onChooseFile={() => file.current?.click()} onDiscard={() => void discard(selected)} />}
  </div>;
}
