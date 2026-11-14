import { lazy, Suspense, useState } from 'react';
import type { Bootstrap, Session } from '../types';
import { NextWorkoutHero } from './NextWorkoutHero';
const TrainingCalendar = lazy(() => import('./TrainingCalendar').then(module => ({ default: module.TrainingCalendar })));
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
  const readVersion = data.resourceVersions?.history ?? data.history;
  const [allHistory, setAllHistory] = useState(false);

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
