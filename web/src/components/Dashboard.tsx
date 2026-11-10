import { lazy, Suspense, useEffect, useState } from 'react';
import type { Bootstrap, ProgressSummary, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { Button } from './ui/Button';
import { NextWorkoutHero } from './NextWorkoutHero';
import { viewReadCache } from '../lib/viewReadCache';
const TrainingCalendar = lazy(() => import('./TrainingCalendar').then(module => ({ default: module.TrainingCalendar })));
const BodyweightRecords = lazy(() => import('./ProgressPanels').then(module => ({ default: module.BodyweightRecords })));
const WorkoutHistory = lazy(() => import('./WorkoutHistory').then(module => ({ default: module.WorkoutHistory })));
import './Dashboard.css';
import { CalendarSkeleton } from './DashboardTrainingSkeleton';
import { Modal } from './ui/Modal';

/** Overview shows the latest few workouts; the whole history opens in a sheet over it. */
const RECENT_WORKOUTS = 3;

interface DashboardProps {
  data: Bootstrap;
  unconfirmed?: boolean;
  onProgram: () => void;
  onImport: () => void;
  onResume: () => void;
  onSession: (s: Session) => void;
  onChanged: () => Promise<void>;
  onExercise?: (id: string) => void;
  onStart?: (templateId: string) => void;
}

export function Dashboard({
  data,
  unconfirmed = false,
  onProgram,
  onResume,
  onSession,
  onExercise,
  onChanged,
  onStart
}: DashboardProps) {
  const readKey = `${data.account.id}:progress`;
  const readVersion = data.resourceVersions?.history ?? data.history;
  const [progress, setProgress] = useState<ProgressSummary | null>(
    unconfirmed ? null : (data.progress ?? viewReadCache.get(readKey, readVersion) ?? null)
  );
  const [progressError, setProgressError] = useState('');
  const [progressRetry, setProgressRetry] = useState(0);
  const [allHistory, setAllHistory] = useState(false);

  useEffect(() => {
    if (unconfirmed) { setProgress(null); setProgressError(''); return; }
    if (data.progress && progressRetry === 0) { setProgress(data.progress); return; }
    const cached = viewReadCache.get<ProgressSummary>(readKey, readVersion);
    setProgress(cached ?? null);
    if (progressRetry === 0 && viewReadCache.fresh(readKey, readVersion)) return;
    let cancelled = false;
    const controller = new AbortController();
    setProgressError('');
    api
      .progress(controller.signal)
      .then(next => {
        if (!cancelled) { viewReadCache.set(readKey, readVersion, next); setProgress(next); }
      })
      .catch(failure => {
        if (!cancelled) {
          setProgressError(failure instanceof ApiError ? failure.message : 'Progress records could not be loaded.');
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [unconfirmed, progressRetry, data.progress, data.account.id, data.resourceVersions?.history ?? data.history]);

  const program = data.activeProgram;
  const unit = data.preferences.unit;

  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <h1 data-page-heading tabIndex={-1}>Overview</h1>
          <p className="dashboard-date-subtitle">
            {new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="overview-hero-calendar-grid">
        <div className="overview-main-column">
          <NextWorkoutHero
            data={data}
            unconfirmed={unconfirmed}
            onStart={onStart ?? (() => onProgram())}
            onResume={onResume}
            onProgram={onProgram}
            onChanged={onChanged}
          />
          {progressError && (
            <div className="error-banner" role="alert">
              <span>{progressError}</span>
              <Button variant="tertiary" onClick={() => setProgressRetry(val => val + 1)}>
                Retry
              </Button>
            </div>
          )}
        </div>
        <div className="overview-calendar-column">
          <Suspense fallback={<CalendarSkeleton />}>
            <TrainingCalendar
              onSession={onSession}
              program={program}
              refreshKey={data.resourceVersions?.history ?? data.history}
              activeWorkoutId={data.activeWorkout?.id ?? null}
              accountId={data.account.id}
              unconfirmed={unconfirmed}
            />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<div className="panel"><div className="skeleton history-row-skeleton" aria-label="Loading recent workouts" /></div>}>
        <WorkoutHistory
          initial={data.historyDeferred ? undefined : data.history}
          accountId={data.account.id}
          refreshKey={readVersion}
          unconfirmed={unconfirmed}
          unit={unit}
          onSession={onSession}
          onStart={onProgram}
          onExercise={onExercise}
          onDeleted={onChanged}
          recent={{ count: RECENT_WORKOUTS, onShowAll: () => setAllHistory(true) }}
        />
      </Suspense>

      <Suspense fallback={<div className="panel skeleton" aria-label="Loading bodyweight records" />}>
        <BodyweightRecords progress={progress} unit={unit} />
      </Suspense>

      {allHistory && (
        <Modal title="Workout history" wide className="history-sheet" onClose={() => setAllHistory(false)}>
          <div className="modal-body">
            <Suspense fallback={<div className="skeleton history-row-skeleton" aria-label="Loading workout history" />}>
              <WorkoutHistory
                initial={data.historyDeferred ? undefined : data.history}
                accountId={data.account.id}
                refreshKey={readVersion}
                unconfirmed={unconfirmed}
                unit={unit}
                onSession={onSession}
                onStart={onProgram}
                onExercise={onExercise}
                onDeleted={onChanged}
                embedded
              />
            </Suspense>
          </div>
        </Modal>
      )}
    </>
  );
}
