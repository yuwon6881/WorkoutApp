import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock3, Dumbbell, Layers, Trash2, Trophy } from 'lucide-react';
import type { HistoryPage, HistorySummaryPage, Session, Unit } from '../types';
import { viewReadCache } from '../lib/viewReadCache';
import { ApiError, api } from '../lib/api';
import { forgetSessionDetail, prefetchSessionDetail } from '../lib/sessionDetailLoad';
import { prefetchView, viewReady } from '../app/lazyViews';
import { duration, showSetCount, showVolume } from '../lib/training';
import { historyDay, historyMonths } from '../lib/historyGroups';
import { Button } from './ui/Button';
import { MenuButton, MenuItem } from './ui/MenuButton';
import { Modal } from './ui/Modal';
import { useLoadMoreOnScroll } from './ui/useLoadMoreOnScroll';
import './History.css';
import './RenderWindow.css';

interface WorkoutHistoryProps {
  initial?: HistoryPage;
  accountId?: string;
  refreshKey?: object | string;
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
  const readKey = `${accountId ?? ''}:history`;
  const cached = viewReadCache.get<HistorySummaryPage>(readKey, refreshKey);
  const [page, setPage] = useState<HistoryPage>(initial ?? { total: cached?.total ?? 0, page: 0, size: 20, sessions: cached?.sessions ?? [] });
  const [cursor, setCursor] = useState<{ at: string | null; id: string | null }>({ at: cached?.nextBeforeAt ?? null, id: cached?.nextBeforeId ?? null });
  const [loading, setLoading] = useState(!initial && !cached);
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
      const snapshot = viewReadCache.get<HistorySummaryPage>(readKey, refreshKey);
      setPage({ total: snapshot?.total ?? 0, page: 0, size: 20, sessions: snapshot?.sessions ?? [] });
      setCursor({ at: snapshot?.nextBeforeAt ?? null, id: snapshot?.nextBeforeId ?? null });
      setLoading(!snapshot);
      if (viewReadCache.fresh(readKey, refreshKey)) return () => active.abort();
      api.historySummaries(null, null, active.signal).then(next => {
        if (active.signal.aborted || generation !== epoch.current) return;
        viewReadCache.set(readKey, refreshKey, next);
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

  /// Pressing a row starts loading the summary's code and the session's exercises, so the tap that
  /// follows opens the summary straight away and the sets are usually already there.
  function prepareSession(session: Session) {
    prefetchView('sessionDetail');
    if (session.exercises.length === 0) prefetchSessionDetail(session.id);
  }

  async function confirmDelete() {
    if (!deleteSession || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteWorkout(deleteSession.id);
      viewReadCache.reset();
      forgetSessionDetail(deleteSession.id);
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
        {historyMonths(sessions).map(month => (
          <section className="history-month" key={month.key} aria-labelledby={`history-month-${month.key}`}>
            <h3 className="history-month-heading" id={`history-month-${month.key}`}>{month.label}</h3>
            {month.sessions.map(session => {
              const prCount = session.prCount ?? 0;
              const hasVolume = session.volumeKg != null && session.volumeKg > 0;
              const day = historyDay(session.startedAt);
              return (
                <div className="history-item-wrap" key={session.id}>
                  <Button
                    className="history-row"
                    variant="tertiary"
                    onPointerEnter={() => prefetchView('sessionDetail')}
                    onPointerDown={() => prepareSession(session)}
                    onFocus={() => prefetchView('sessionDetail')}
                    onClick={() => { prepareSession(session); void viewReady('sessionDetail').then(() => onSession(session)); }}
                  >
                    <span className="history-date" aria-hidden="true">
                      <span>{day.month}</span>
                      <strong>{day.day}</strong>
                    </span>
                    <span className="row-title">
                      <strong>{session.name}</strong>
                      <span className="sr-only">{day.full}</span>
                      <span className="history-stats">
                        <span><Clock3 size={13} aria-hidden="true" />{duration(session)} min</span>
                        <span><Layers size={13} aria-hidden="true" />{showSetCount(session.completedSets)}</span>
                        {hasVolume && <span className="history-volume"><Dumbbell size={13} aria-hidden="true" />{showVolume(session.volumeKg, unit)}</span>}
                        {prCount > 0 && (
                          <span className="pill pill-accent history-pr-pill">
                            <Trophy size={12} aria-hidden="true" />{prCount} {prCount === 1 ? 'PR' : 'PRs'}
                          </span>
                        )}
                      </span>
                    </span>
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
          </section>
        ))}
      </div>

      {loading && !sessions.length && (
        <div className="history-loading-list" aria-label="Loading workout history">
          {[0, 1, 2].map(row => (
            <div className="history-row-skeleton-shape" key={row}>
              <div className="skeleton history-date-skeleton" />
              <div className="history-row-skeleton-lines">
                <div className="skeleton history-title-skeleton" />
                <div className="skeleton history-stats-skeleton" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!sessions.length && !loading && (
        <div className="empty-message">
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
