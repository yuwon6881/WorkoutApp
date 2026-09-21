import { useCallback, useEffect, useState } from 'react';
import { Clock3, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react';
import type { ProgramDraftSummary, ProgramDraftView } from '../types';
import { ApiError, api } from '../lib/api';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

type Props = {
  onResume: (draft: ProgramDraftView) => void | Promise<void>;
  onDraftCount?: (count: number | null) => void;
  refreshKey?: string | number;
};

export function ProgramDraftsSection({ onResume, onDraftCount, refreshKey }: Props) {
  const [drafts, setDrafts] = useState<ProgramDraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<ProgramDraftSummary | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const items = await api.programDrafts();
      const openDrafts = items.filter(item => !item.createdProgramId);
      setDrafts(openDrafts);
      onDraftCount?.(openDrafts.length);
    } catch (failure) {
      setLoadError(failure instanceof ApiError ? failure.message : 'Could not load custom program drafts.');
      onDraftCount?.(null);
    } finally {
      setLoading(false);
    }
  }, [onDraftCount]);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  async function resume(summary: ProgramDraftSummary) {
    setBusyId(summary.id);
    setActionError('');
    try {
      const detail = await api.getProgramDraft(summary.id);
      if (!detail.draft || detail.createdProgramId) {
        await refresh();
        return;
      }
      await onResume({ ...detail, draft: detail.draft });
    } catch (failure) {
      setActionError(failure instanceof ApiError ? failure.message : 'Could not open this program draft.');
    } finally {
      setBusyId(null);
    }
  }

  async function discard() {
    if (!discardTarget) return;
    setDiscarding(true);
    setActionError('');
    try {
      await api.deleteProgramDraft(discardTarget.id);
      setDiscardTarget(null);
      await refresh();
    } catch (failure) {
      setActionError(failure instanceof ApiError ? failure.message : 'Could not discard this program draft.');
    } finally {
      setDiscarding(false);
    }
  }

  return <section className="panel program-section" aria-labelledby="custom-program-drafts-title">
    <div className="section-heading">
      <h2 id="custom-program-drafts-title">Custom program drafts</h2>
      {!loading && <span className="muted">{drafts.length}</span>}
    </div>

    {loadError && <div className="error-banner" role="alert">{loadError}<Button variant="tertiary" onClick={() => void refresh()}><RotateCcw size={15} />Retry</Button></div>}
    {actionError && <p className="error-text" role="alert">{actionError}</p>}
    {loading && <p className="muted" role="status"><LoaderCircle className="spin" size={16} /> Loading drafts…</p>}
    {!loading && !loadError && drafts.length === 0 && <div className="empty-message">
      <p>No custom program drafts yet. Start a new program to save and resume it while you build.</p>
    </div>}
    {!loading && !loadError && drafts.length >= 20 && <p className="muted small-copy" role="status">
      You’ve reached the 20 draft limit. Discard a draft before starting another program.
    </p>}
    {!loading && drafts.length > 0 && <div className="program-draft-list">
      {drafts.map(summary => <article className="program-draft-row" key={summary.id}>
        <div className="program-draft-info">
          <h3>{summary.programName.trim() || 'Untitled program'}</h3>
          <p><Clock3 size={14} />Last saved {formatSavedDate(summary.updated)}</p>
        </div>
        <div className="program-draft-actions">
          <Button variant="primary" disabled={busyId !== null} onClick={() => void resume(summary)}>
            {busyId === summary.id ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}
            {busyId === summary.id ? 'Opening…' : 'Resume'}
          </Button>
          <Button variant="destructive" disabled={busyId !== null || discarding} aria-label={`Discard ${summary.programName || 'untitled program'} draft`} onClick={() => setDiscardTarget(summary)}>
            <Trash2 size={15} />Discard
          </Button>
        </div>
      </article>)}
    </div>}

    {discardTarget && <Modal title="Discard program draft?" onClose={() => !discarding && setDiscardTarget(null)}>
      <div className="modal-body">
        <p>This permanently deletes <strong>{discardTarget.programName.trim() || 'Untitled program'}</strong> and its unsaved plan.</p>
      </div>
      <div className="modal-actions">
        <Button variant="tertiary" disabled={discarding} onClick={() => setDiscardTarget(null)}>Cancel</Button>
        <Button variant="destructive" disabled={discarding} onClick={() => void discard()}>{discarding ? 'Discarding…' : 'Discard draft'}</Button>
      </div>
    </Modal>}
  </section>;
}

function formatSavedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
