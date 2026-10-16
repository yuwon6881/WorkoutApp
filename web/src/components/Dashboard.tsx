import { lazy, Suspense, useEffect, useState } from 'react';
import type { Bootstrap, ProgressSummary, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { Button } from './ui/Button';
import { NextWorkoutHero } from './NextWorkoutHero';
import { viewReadCache } from '../lib/viewReadCache';
import type { CalendarWeekSummary } from '../lib/calendarWeekSummary';
const TrainingCalendar = lazy(() => import('./TrainingCalendar').then(module => ({ default: module.TrainingCalendar })));
const BodyweightRecords = lazy(() => import('./ProgressPanels').then(module => ({ default: module.BodyweightRecords })));
const ProgressStats = lazy(() => import('./ProgressPanels').then(module => ({ default: module.ProgressStats })));
const WorkoutHistory = lazy(() => import('./WorkoutHistory').then(module => ({ default: module.WorkoutHistory })));
import './Dashboard.css';
import { CalendarSkeleton, ProgressStatsSkeleton } from './DashboardTrainingSkeleton';

interface DashboardProps {
  data: Bootstrap;
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
  onProgram,
  onResume,
  onSession,
  onExercise,
  onChanged,
  onStart
}: DashboardProps) {
  const readKey = `${data.account.id}:progress`;
  const readVersion = data.resourceVersions?.history ?? data.history;
  const [progress, setProgress] = useState<ProgressSummary | null>(data.progress ?? viewReadCache.get(readKey, readVersion) ?? null);
  const [progressError, setProgressError] = useState('');
  const [progressRetry, setProgressRetry] = useState(0);
  const [calendarWeek, setCalendarWeek] = useState<CalendarWeekSummary | null>(null);

  useEffect(() => {
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
  }, [progressRetry, data.progress, data.account.id, data.resourceVersions?.history ?? data.history]);

  const program = data.activeProgram;
  const unit = data.preferences.unit;

  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <h1 data-page-heading tabIndex={-1}>Overview</h1>
          <p className="dashboard-date-subtitle">
            {new Date().toLocaleDateString('en', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric'
            })}
          </p>
        </div>
      </div>

      <div className="overview-hero-calendar-grid">
        <div className="overview-main-column">
          <NextWorkoutHero
            data={data}
            onStart={onStart ?? (() => onProgram())}
            onResume={onResume}
            onProgram={onProgram}
            onChanged={onChanged}
          />
          <Suspense fallback={<ProgressStatsSkeleton />}>
            <ProgressStats week={calendarWeek} />
          </Suspense>
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
              onWeekChange={setCalendarWeek}
            />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<div className="panel skeleton" aria-label="Loading bodyweight records" />}>
        <BodyweightRecords progress={progress} unit={unit} />
      </Suspense>

      <Suspense fallback={<div className="panel"><div className="skeleton history-row-skeleton" aria-label="Loading workout history" /></div>}>
        <WorkoutHistory
          initial={data.historyDeferred ? undefined : data.history}
          accountId={data.account.id}
          refreshKey={readVersion}
          unit={unit}
          onSession={onSession}
          onStart={onProgram}
          onExercise={onExercise}
          onDeleted={onChanged}
        />
      </Suspense>
    </>
  );
}
