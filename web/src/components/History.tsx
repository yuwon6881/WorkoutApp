import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, Dumbbell, Trophy } from 'lucide-react';
import type { HistoryPage, Preferences, ProgressSummary, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { duration, showActualRir, showSetCount, showVolume, toDisplay } from '../lib/training';
import { Button } from './ui/Button';
import { BodyweightRecords, ProgressStats } from './ProgressPanels';
import './History.css';

let progressCache: ProgressSummary | null = null;
let historyCache: HistoryPage | null = null;
export function clearHistoryViewCache() { progressCache = null; historyCache = null; }

function isSameHistory(a: HistoryPage, b: HistoryPage): boolean {
  if (a.total !== b.total || a.page !== b.page || a.sessions.length !== b.sessions.length) return false;
  for (let i = 0; i < a.sessions.length; i++) {
    const s1 = a.sessions[i];
    const s2 = b.sessions[i];
    if (s1.id !== s2.id || s1.startedAt !== s2.startedAt || s1.finishedAt !== s2.finishedAt || s1.completedSets !== s2.completedSets || s1.volumeKg !== s2.volumeKg || s1.prCount !== s2.prCount) {
      return false;
    }
  }
  return true;
}

export function HistoryView({ initial, initialProgress, preferences, onSession, onStart, onExercise, onMuscles }: {
  initial: HistoryPage; initialProgress?: ProgressSummary; preferences: Preferences; onSession: (s: Session) => void; onStart: () => void; onExercise?: (id: string) => void; onMuscles: () => void;
}) {
  if (!historyCache && initial) historyCache = initial;
  if (!progressCache && initialProgress) progressCache = initialProgress;

  const [page, setPage] = useState<HistoryPage>(historyCache ?? initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ProgressSummary | null>(progressCache ?? initialProgress ?? null);
  const [progressError, setProgressError] = useState('');
  const [progressRetry, setProgressRetry] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const unit = preferences.unit;

  useEffect(() => {
    if (initial) {
      historyCache = initial;
      setPage(current => isSameHistory(current, initial) ? current : initial);
    }
  }, [initial]);

  useEffect(() => {
    if (initialProgress) {
      progressCache = initialProgress;
      setProgress(initialProgress);
    }
  }, [initialProgress]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    api.history(0, 20, controller.signal)
      .then(next => {
        if (!cancelled) {
          historyCache = next;
          setPage(current => isSameHistory(current, next) ? current : next);
          setError('');
        }
      })
      .catch(failure => {
        if (!cancelled && !page.sessions.length && !error) {
          setError(failure instanceof ApiError ? failure.message : 'Could not load your history.');
        }
      });
    api.refreshNutritionContext(controller.signal).catch(() => { /* progression context is optional */ });
    return () => { cancelled = true; controller.abort(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setProgressError('');
    api.progress(controller.signal)
      .then(next => { if (!cancelled) { progressCache = next; setProgress(next); } })
      .catch(failure => { if (!cancelled && !progress) setProgressError(failure instanceof ApiError ? failure.message : 'Progress records could not be loaded.'); });
    return () => { cancelled = true; controller.abort(); };
  }, [progressRetry]);

  async function more() {
    setLoading(true);
    try {
      const next = await api.history(page.page + 1, page.size);
      const merged = { ...next, sessions: [...page.sessions, ...next.sessions] };
      historyCache = merged;
      setPage(merged);
    } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Could not load more history.'); }
    finally { setLoading(false); }
  }

  const sessions = page.sessions;
  return <>
    <div className="page-heading progress-page-heading">
      <div><h1>Progress</h1></div>
      <Button variant="secondary" className="progress-muscles-link" onClick={onMuscles}>See muscle coverage<ArrowRight size={16} /></Button>
    </div>
    <ProgressStats progress={progress} unit={unit} />
    {progressError && <div className="error-banner" role="alert"><span>{progressError}</span><Button variant="tertiary" onClick={() => setProgressRetry(value => value + 1)}>Retry</Button></div>}
    <BodyweightRecords progress={progress} unit={unit} />
    <section className="panel">
      <div className="section-heading"><h2>Workout history</h2><span className="muted">{sessions.length} of {page.total}</span></div>
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
              onClick={() => setExpandedId(current => current === session.id ? null : session.id)}
            >
              <span className="exercise-icon"><Dumbbell size={20} /></span>
              <span className="row-title">
                <strong>{session.name}</strong>
                <small>{new Date(session.startedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })} · {duration(session)} min · {showSetCount(session.completedSets)}</small>
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
                <div className="history-expanded-exercises">
                  {session.exercises.map(exercise => (
                    <div className="history-exercise-row" key={exercise.id}>
                      <div className="history-exercise-head">
                        {exercise.exerciseId && onExercise ? (
                          <Button variant="tertiary" className="history-exercise-btn" onClick={() => onExercise(exercise.exerciseId!)} aria-label={`Open ${exercise.name} exercise details`}>
                            <strong>{exercise.name}</strong><ArrowRight size={13} />
                          </Button>
                        ) : (
                          <strong>{exercise.name}</strong>
                        )}
                        {exercise.isPr && (
                          <span className="pill pill-accent pr-exercise-badge">
                            <Trophy size={12} /> PR{exercise.prE1rmKg != null ? ` · ${toDisplay(exercise.prE1rmKg, unit)} ${unit} e1RM` : ''}
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
                              <span>{set.weightKg === null ? `${set.reps} reps` : `${toDisplay(set.weightKg, unit)} ${unit} × ${set.reps}`}</span>
                              {showActualRir(set.rir, set.rpe) !== '—' && <span className="muted">{showActualRir(set.rir, set.rpe)}</span>}
                              {set.isPr && <span className="pill pill-accent pr-set-tag"><Trophy size={10} /> PR</span>}
                            </div>
                          );
                        })}
                      </div>
                      {exercise.note && <p className="history-exercise-note">{exercise.note}</p>}
                    </div>
                  ))}
                </div>
                {session.note && <p className="note-block">{session.note}</p>}
                <div className="history-expanded-actions">
                  <Button variant="secondary" onClick={() => onSession(session)}>
                    Full workout details<ArrowRight size={15} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {loading && !sessions.length && <div className="history-loading-list" aria-label="Loading workout history">{[0, 1, 2].map(row => <div className="skeleton history-row-skeleton" key={row} />)}</div>}
      {!sessions.length && !loading && <div className="empty-message"><Dumbbell size={32} /><h3>No workouts yet</h3>
        <p>Finish a workout to see its sets and volume here.</p>
        <Button onClick={onStart}>Find a workout<ArrowRight size={16} /></Button></div>}
      {sessions.length < page.total && <Button className="full-width" disabled={loading} onClick={more}>{loading ? 'Loading…' : 'Load more'}</Button>}
    </section>

  </>;
}
