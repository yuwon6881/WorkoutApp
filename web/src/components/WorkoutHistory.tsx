import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, Dumbbell, Trophy } from 'lucide-react';
import type { HistoryPage, Session, Unit } from '../types';
import { ApiError, api } from '../lib/api';
import { duration, showActualRir, showSetCount, showVolume, toDisplay } from '../lib/training';
import { formatExercisePrBadge, formatSetPrTag } from '../lib/livePr';
import { MotionPanel } from './ui/Motion';
import { Button } from './ui/Button';
import { useLoadMoreOnScroll } from './ui/useLoadMoreOnScroll';
import './History.css';
import './RenderWindow.css';
import { showTimedSet } from '../lib/setDuration';
import { useTrackRir } from '../lib/trackRir';

interface WorkoutHistoryProps {
  initial?: HistoryPage;
  accountId?: string;
  refreshKey?: object;
  unit: Unit;
  onSession: (s: Session) => void;
  onStart: () => void;
  onExercise?: (id: string) => void;
}

export function WorkoutHistory({
  initial,
  accountId,
  refreshKey,
  unit,
  onSession,
  onStart,
  onExercise
}: WorkoutHistoryProps) {
  const [page, setPage] = useState<HistoryPage>(initial ?? { total: 0, page: 0, size: 20, sessions: [] });
  const [cursor, setCursor] = useState<{ at: string | null; id: string | null }>({ at: null, id: null });
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const trackRir = useTrackRir();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Session>>({});
  const controller = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const epoch = useRef(0);

  useEffect(() => {
    const generation = ++epoch.current;
    controller.current?.abort(); detailController.current?.abort();
    const active = new AbortController(); controller.current = active;
    busy.current = false;
    setDetails({}); setExpandedId(null); setError('');
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
    return () => { active.abort(); detailController.current?.abort(); };
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

  async function expand(session: Session) {
    detailController.current?.abort();
    if (expandedId === session.id) { setExpandedId(null); return; }
    setExpandedId(session.id); setError('');
    if (session.exercises.length || details[session.id]) return;
    const active = new AbortController(); detailController.current = active;
    try {
      const detail = await api.getWorkout(session.id, active.signal);
      if (!active.signal.aborted) setDetails(current => ({ ...current, [session.id]: detail }));
    } catch (failure) {
      if (!active.signal.aborted) setError(failure instanceof ApiError ? failure.message : 'Could not load workout details.');
    }
  }

  const sessions = page.sessions.map(session => details[session.id] ?? session);

  return (
    <section className={`panel${sessions.length > 100 ? ' history-windowed' : ''}`} aria-label="Workout history">
      <div className="section-heading">
        <h2>Workout history</h2>
        <span className="muted">{sessions.length} of {page.total}</span>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {sessions.map(session => {
        const isExpanded = expandedId === session.id;
        const prCount = session.prCount ?? 0;
        return (
          <div className="history-item-wrap" key={session.id}>
            <Button
              className={`history-row ${isExpanded ? 'open' : ''}`}
              variant="tertiary"
              aria-expanded={isExpanded}
              aria-controls={`history-detail-${session.id}`}
              onClick={() => void expand(session)}
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
              <span>{showVolume(session.volumeKg, unit)}</span>
              <ChevronDown size={16} className={`history-expand-icon ${isExpanded ? 'open' : ''}`} />
            </Button>

            {isExpanded && (
              <div className="history-expanded-content" id={`history-detail-${session.id}`}>
                {!session.exercises.length && <div className="skeleton history-row-skeleton" aria-label="Loading workout details" />}
                <MotionPanel motionKey={session.id} animateOnMount className="history-expanded-exercises">
                  {session.exercises.map(exercise => (
                    <div className="history-exercise-row" key={exercise.id}>
                      <div className="history-exercise-head">
                        {exercise.exerciseId && onExercise ? (
                          <Button
                            variant="tertiary"
                            className="history-exercise-btn"
                            onClick={() => onExercise(exercise.exerciseId!)}
                            aria-label={`Open ${exercise.name} exercise details`}
                          >
                            <strong>{exercise.name}</strong><ArrowRight size={13} />
                          </Button>
                        ) : (
                          <strong>{exercise.name}</strong>
                        )}
                        {exercise.isPr && (
                          <span className="pill pill-accent pr-exercise-badge">
                            <Trophy size={12} /> {formatExercisePrBadge(exercise, unit)}
                          </span>
                        )}
                      </div>
                      <div className="history-exercise-sets">
                        {exercise.sets.filter(s => s.done).map((set, i, completed) => {
                          const warmupNumber = completed.slice(0, i + 1).filter(item => item.warmup).length;
                          const workingNumber = completed.slice(0, i + 1).filter(item => !item.warmup).length;
                          return (
                            <div key={set.id} className={`history-set-item ${set.isPr ? 'pr-set' : ''}`}>
                              <span className="muted">{set.warmup ? `W${warmupNumber}` : `Set ${workingNumber}`}</span>
                              <strong>{set.durationSeconds != null ? showTimedSet(set, unit) : set.weightKg === null ? `${set.reps} reps` : `${toDisplay(set.weightKg, unit)} ${unit} × ${set.reps}`}</strong>
                              {trackRir && <span className="muted">{showActualRir(set.rir, set.rpe)}</span>}
                              {set.isPr && <span className="pill pill-accent pr-set-tag"><Trophy size={10} /> {formatSetPrTag(set)}</span>}
                            </div>
                          );
                        })}
                      </div>
                      {exercise.note && <p className="history-exercise-note">{exercise.note}</p>}
                    </div>
                  ))}
                </MotionPanel>
                {session.note && <p className="note-block">{session.note}</p>}
                <div className="history-expanded-actions">
                  <Button variant="secondary" disabled={!session.exercises.length && !details[session.id]} onClick={() => onSession(session)}>
                    Full workout details <ArrowRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

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
    </section>
  );
}
