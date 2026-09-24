import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, Dumbbell, Play } from 'lucide-react';
import type { Bootstrap, ProgressSummary, Session } from '../types';
import { ApiError, api } from '../lib/api';
import { Button } from './ui/Button';
import { TrainingCalendar } from './TrainingCalendar';
import { BodyweightRecords, ProgressStats } from './ProgressPanels';
import { WorkoutHistory } from './WorkoutHistory';
import './Dashboard.css';

interface DashboardProps {
  data: Bootstrap;
  onStart: (templateId: string) => void;
  onProgram: () => void;
  onImport: () => void;
  onResume: () => void;
  onSession: (s: Session) => void;
  onChanged: () => Promise<void>;
  onExercise?: (id: string) => void;
}

export function Dashboard({
  data,
  onStart,
  onProgram,
  onResume,
  onSession,
  onExercise
}: DashboardProps) {
  const [progress, setProgress] = useState<ProgressSummary | null>(data.progress ?? null);
  const [progressError, setProgressError] = useState('');
  const [progressRetry, setProgressRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setProgressError('');
    api
      .progress(controller.signal)
      .then(next => {
        if (!cancelled) setProgress(next);
      })
      .catch(failure => {
        if (!cancelled && !progress) {
          setProgressError(failure instanceof ApiError ? failure.message : 'Progress records could not be loaded.');
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [progressRetry]);

  const program = data.activeProgram;
  const next = program
    ? program.days.find(w => w.id === program.nextTemplateId) ?? null
    : data.templates[0] ?? null;
  const nextName = next ? next.name : null;
  const nextFocus = next && 'focus' in next ? next.focus : null;
  const nextWeek = next?.week ?? 1;
  const nextExerciseCount = next && 'exerciseCount' in next ? next.exerciseCount : next?.exercises.length ?? 0;
  const nextSets =
    next && 'exerciseCount' in next
      ? null
      : next?.exercises.reduce((total, e) => total + e.sets.filter(s => !s.warmup).length, 0) ?? 0;

  const unit = data.preferences.unit;

  const activeWorkout = data.activeWorkout?.active ? data.activeWorkout : null;

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

      <section className="next-workout quick-start-hero" aria-label="Today's workout quick start">
        <div className="hero-top">
          <span className="eyebrow">
            <span className="status-dot" />{' '}
            {activeWorkout
              ? 'Workout in progress'
              : next
                ? program
                  ? "Today's training"
                  : 'Quick start'
                : 'Ready to train'}
          </span>
          <span className="pill">
            {activeWorkout
              ? `${activeWorkout.exercises.length} exercises`
              : next
                ? `${nextExerciseCount} exercises`
                : 'No workout queued'}
          </span>
        </div>

        <div className="hero-content">
          <div>
            <h2>
              {activeWorkout
                ? activeWorkout.name
                : nextName ?? 'Choose a workout'}
            </h2>
            <p>
              {activeWorkout
                ? 'In progress · pick up where you left off'
                : next
                  ? program
                    ? `${program.name} · week ${nextWeek}`
                    : nextFocus || 'Ready to start'
                  : 'Select a routine from your library or start a program to begin training.'}
            </p>
            <div className="hero-facts">
              {(() => {
                const workingSetCount = activeWorkout
                  ? activeWorkout.exercises.reduce(
                      (total, e) => total + e.sets.filter(s => !s.warmup).length,
                      0
                    )
                  : nextSets;
                if (workingSetCount && workingSetCount > 0) {
                  return (
                    <span>
                      <Dumbbell size={15} />
                      {`${workingSetCount} working sets`}
                    </span>
                  );
                }
                const savedRoutines = data.templates.length;
                const savedPrograms = data.programs.length;
                return (
                  <>
                    <span>
                      <Dumbbell size={15} />
                      {savedRoutines > 0 ? `${savedRoutines} saved ${savedRoutines === 1 ? 'routine' : 'routines'}` : 'Workout library'}
                    </span>
                    {savedPrograms > 0 && (
                      <span>
                        <CalendarDays size={15} />
                        {`${savedPrograms} ${savedPrograms === 1 ? 'program' : 'programs'}`}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        <div className="hero-bottom">
          {activeWorkout ? (
            <Button variant="primary" onClick={onResume}>
              <Play size={17} fill="currentColor" /> Resume workout <ArrowRight size={18} />
            </Button>
          ) : next ? (
            <Button variant="primary" onClick={() => onStart(next.id)}>
              <Play size={17} fill="currentColor" /> Start workout <ArrowRight size={18} />
            </Button>
          ) : program ? (
            <Button variant="primary" onClick={onProgram}>
              <Check size={17} /> Open workouts <ArrowRight size={18} />
            </Button>
          ) : (
            <Button variant="primary" onClick={onProgram}>
              <Dumbbell size={17} /> Go to workouts <ArrowRight size={18} />
            </Button>
          )}
          <span>
            {activeWorkout
              ? 'Session recoverable on this device'
              : next
                ? 'Ready to log sets & rest'
                : 'Browse routines or active programs'}
          </span>
        </div>
      </section>

      <TrainingCalendar onSession={onSession} />

      <ProgressStats progress={progress} unit={unit} />

      {progressError && (
        <div className="error-banner" role="alert">
          <span>{progressError}</span>
          <Button variant="tertiary" onClick={() => setProgressRetry(val => val + 1)}>
            Retry
          </Button>
        </div>
      )}

      <BodyweightRecords progress={progress} unit={unit} />

      <WorkoutHistory
        initial={data.history}
        unit={unit}
        onSession={onSession}
        onStart={onProgram}
        onExercise={onExercise}
      />
    </>
  );
}
