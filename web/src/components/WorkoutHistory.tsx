import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Dumbbell, Trash2, Trophy } from 'lucide-react';
import type { HistoryPage, Session, Unit } from '../types';
import { ApiError, api } from '../lib/api';
import { duration, showSetCount, showVolume } from '../lib/training';
import { Button } from './ui/Button';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { Modal } from './ui/Modal';
import { useLoadMoreOnScroll } from './ui/useLoadMoreOnScroll';
import './History.css';
import './RenderWindow.css';

interface WorkoutHistoryProps {
  initial?: HistoryPage;
  accountId?: string;
  refreshKey?: object;
  unit: Unit;
  onSession: (s: Session) => void;
  onStart: () => void;
  onExercise?: (id: string) => void;
  onDeleted?: () => Promise<void>;
}

export function WorkoutHistory({
  initial,
  accountId,
  refreshKey,
  unit,
  onSession,
  onStart,
  onDeleted
}: WorkoutHistoryProps) {
  const [page, setPage] = useState<HistoryPage>(initial ?? { total: 0, page: 0, size: 20, sessions: [] });
  const [cursor, setCursor] = useState<{ at: string | null; id: string | null }>({ at: null, id: null });
  const [loading, setLoading] = useState(!initial);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [deleteSession, setDeleteSession] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const epoch = useRef(0);

  useEffect(() => {
    const generation = ++epoch.current;
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    busy.current = false;
    setError('');
    if (initial) {
      setPage(initial); setLoading(false);
      const last = initial.sessions.at(-1);
      setCursor({ at: last?.finishedAt ?? null, id: last?.id ?? null });
    } else {
      setLoading(true);
      api.historySummaries(null, null, active.signal).then(next => {
        if (generation !== epoch.current) return;
        setPage({ total: next.total, page: 0, size: 20, sessions: next.sessions });
        setCursor({ at: next.nextBeforeAt, id: next.nextBeforeId });
      }).catch(failure => {
        if (!active.signal.aborted) setError(failure instanceof ApiError ? failure.message : 'Could not load your history.');
      }).finally(() => { if (generation === epoch.current) setLoading(false); });
    }
    return () => { active.abort(); };
  }, [initial, accountId, refreshKey]);

  const hasMore = page.sessions.length < page.total && Boolean(cursor.at && cursor.id);
  const loadMoreRef = useLoadMoreOnScroll(!loading && hasMore && !error, () => void more());

  async function more() {
    if (busy.current || !hasMore) return;
    busy.current = true; setLoading(true); setError('');
    const generation = epoch.current;
    try {
      const next = await api.historySummaries(cursor.at, cursor.id, controller.current?.signal);
      if (generation !== epoch.current) return;
      setPage(current => ({ ...current, total: next.total, page: current.page + 1,
        sessions: [...new Map([...current.sessions, ...next.sessions].map(session => [session.id, session])).values()] }));
      setCursor({ at: next.nextBeforeAt, id: next.nextBeforeId });
    } catch (failure) {
      if (!controller.current?.signal.aborted) setError(failure instanceof ApiError ? failure.message : 'Could not load more history.');
    } finally { if (generation === epoch.current) { busy.current = false; setLoading(false); } }
  }

  async function handleOpenSession(session: Session) {
    if (session.exercises && session.exercises.length > 0) {
      onSession(session);
      return;
    }
    setOpeningId(session.id);
    setError('');
    try {
      const full = await api.getWorkout(session.id);
      onSession(full);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not load workout details.');
    } finally {
      setOpeningId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteSession || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteWorkout(deleteSession.id);
      setPage(current => ({
        ...current,
        total: Math.max(0, current.total - 1),
        sessions: current.sessions.filter(s => s.id !== deleteSession.id)
      }));
      setDeleteSession(null);
      if (onDeleted) await onDeleted();
    } catch (failure) {
      setDeleteError(failure instanceof ApiError ? failure.message : 'Could not delete this workout.');
    } finally {
      setDeleting(false);
    }
  }

  const sessions = page.sessions;

  return (
    <section className={`panel${sessions.length > 100 ? ' history-windowed' : ''}`} aria-label="Workout history">
      <div className="section-heading">
        <h2>Workout history</h2>
        <span className="muted">{sessions.length} of {page.total}</span>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="history-list">
        {sessions.map(session => {
          const prCount = session.prCount ?? 0;
          const hasVolume = session.volumeKg != null && session.volumeKg > 0;
          return (
            <div className="history-item-wrap" key={session.id}>
              <Button
                className="history-row"
                variant="tertiary"
                disabled={openingId === session.id}
                onClick={() => void handleOpenSession(session)}
              >
                <span className="exercise-icon"><Dumbbell size={20} /></span>
                <span className="row-title">
                  <strong>{session.name}</strong>
                  <small>
                    {new Date(session.startedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })} · {duration(session)} min · {showSetCount(session.completedSets)}
                  </small>
                </span>
                {prCount > 0 && (
                  <span className="pill pill-accent history-pr-pill">
                    <Trophy size={12} /> {prCount} {prCount === 1 ? 'PR' : 'PRs'}
                  </span>
                )}
                {hasVolume && <span className="history-volume">{showVolume(session.volumeKg, unit)}</span>}
              </Button>
              <MenuButton
                label={`Actions for ${session.name}`}
                variant="tertiary"
                triggerClassName="history-menu-trigger"
                portal
              >
                <MenuItem destructive onClick={() => { setDeleteError(''); setDeleteSession(session); }}>
                  <Trash2 size={14} /> Delete from history
                </MenuItem>
              </MenuButton>
            </div>
          );
        })}
      </div>

      {loading && !sessions.length && (
        <div className="history-loading-list" aria-label="Loading workout history">
          {[0, 1, 2].map(row => <div className="skeleton history-row-skeleton" key={row} />)}
        </div>
      )}

      {!sessions.length && !loading && (
        <div className="empty-message">
          <Dumbbell size={32} />
          <h3>No workouts yet</h3>
          <p>Finish a workout to see its sets and volume here.</p>
          <Button onClick={onStart}>Find a workout<ArrowRight size={16} /></Button>
        </div>
      )}

      {hasMore && (
        <Button ref={loadMoreRef} className="full-width" disabled={loading} onClick={more}>
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      )}

      {deleteSession && (
        <Modal title="Delete workout?" onClose={() => { if (!deleting) setDeleteSession(null); }}>
          <div className="modal-body">
            <p>Are you sure you want to delete &ldquo;{deleteSession.name}&rdquo; from your history? This action cannot be undone.</p>
            {deleteError && <p className="error-text" role="alert">{deleteError}</p>}
            <div className="modal-actions">
              <Button variant="tertiary" disabled={deleting} onClick={() => setDeleteSession(null)}>Cancel</Button>
              <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
