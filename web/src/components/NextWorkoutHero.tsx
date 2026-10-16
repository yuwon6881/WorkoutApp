import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Play } from 'lucide-react';
import type { Bootstrap, ProgramSummary } from '../types';
import { ApiError, api } from '../lib/api';
import { nextWorkout } from '../lib/nextWorkout';
import { getPlannedMuscleCredits } from '../lib/programMuscles';
import { passableRestDayId, programDayActionInput } from '../lib/programDayState';
import { Button } from './ui/Button';
import { MuscleThumb } from './MuscleThumb';
import { WorkoutElapsed } from './WorkoutElapsed';
import './NextWorkoutHero.css';

interface NextWorkoutHeroProps {
  data: Bootstrap;
  onStart: (templateId: string) => void;
  onResume: () => void;
  onProgram: () => void;
  /** Reloads the program after a change; without it the hero offers no action that changes the program. */
  onChanged?: () => Promise<void>;
}

interface HeroStatusCardProps {
  ariaLabel: string;
  variant?: string;
  statusClass?: string;
  statusLabel: string;
  programBadge?: string;
  title: string;
  description: string;
  actionLabel: string;
  actionVariant?: 'primary' | 'secondary';
  onAction: () => void;
  /** An action that comes before the main one, such as passing a rest day. */
  leadingAction?: ReactNode;
  error?: string;
}

function HeroStatusCard({
  ariaLabel,
  variant,
  statusClass = '',
  statusLabel,
  programBadge,
  title,
  description,
  actionLabel,
  actionVariant = 'secondary',
  onAction,
  leadingAction,
  error
}: HeroStatusCardProps) {
  return (
    <section className={`panel next-workout-hero ${variant ?? ''}`.trim()} aria-label={ariaLabel}>
      <div className="hero-eyebrow">
        <span className={`hero-status-pill ${statusClass}`.trim()}>
          {statusLabel}
        </span>
        {programBadge && <span className="hero-program-pill">{programBadge}</span>}
      </div>

      <div className="hero-body">
        <div className="hero-meta-col">
          <h2 className="hero-title">{title}</h2>
          <p className="hero-description">{description}</p>
        </div>
      </div>

      <div className="hero-footer">
        {leadingAction}
        <Button variant={actionVariant} className="hero-action-btn" onClick={onAction}>
          {actionLabel}
          <ArrowRight size={15} aria-hidden="true" />
        </Button>
      </div>
      {error && <p className="error-text hero-error" role="alert">{error}</p>}
    </section>
  );
}

function RestDayHero({
  programName,
  week,
  title = 'Rest & Recovery',
  description = 'Scheduled rest. Training resumes with your next planned workout.',
  onProgram,
  pass
}: {
  programName?: string;
  week?: number;
  title?: string;
  description?: string;
  onProgram: () => void;
  /** The program and pending rest day to pass; absent when this view cannot change the program. */
  pass?: { program: ProgramSummary; dayId: string; onChanged: () => Promise<void> };
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function passRestDay() {
    if (!pass || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.passProgramRestDay(pass.program.id, pass.dayId, programDayActionInput(pass.program));
      await pass.onChanged();
    } catch (failure) {
      setError(failure instanceof ApiError || failure instanceof Error ? failure.message : 'Could not update this rest day.');
    } finally { setBusy(false); }
  }

  return (
    <HeroStatusCard
      ariaLabel="Scheduled rest day"
      variant="is-rest"
      statusClass="rest-pill"
      statusLabel="Rest day"
      programBadge={programName ? `${programName}${week ? ` · Week ${week}` : ''}` : undefined}
      title={title}
      description={description}
      actionLabel="View program schedule"
      actionVariant="secondary"
      onAction={onProgram}
      error={error}
      leadingAction={pass ? (
        <Button variant="primary" className="hero-action-btn" disabled={busy} onClick={() => void passRestDay()}>
          <Check size={16} aria-hidden="true" />
          {busy ? 'Passing rest day…' : 'Pass rest day'}
        </Button>
      ) : undefined}
    />
  );
}

function HeroMuscles({ muscles }: { muscles: { muscle: string; sets: number }[] }) {
  if (muscles.length === 0) return null;
  return (
    <div className="hero-muscles-col" aria-label="Target muscles">
      <div className="hero-muscle-thumbs">
        {muscles.map(m => (
          <div key={m.muscle} className="hero-muscle-crop" title={`${m.muscle} (${m.sets} planned sets)`}>
            <MuscleThumb muscle={m.muscle} shade={1} aspect={1} className="hero-thumb-svg" />
            <span className="hero-muscle-name">{m.muscle}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NextWorkoutHero({ data, onStart, onResume, onProgram, onChanged }: NextWorkoutHeroProps) {
  const activeWorkout = data.activeWorkout?.active ? data.activeWorkout : null;
  const program = data.activeProgram;
  const passRest = (preferredId?: string) => {
    const dayId = onChanged && program ? passableRestDayId(program, preferredId) : null;
    return program && onChanged && dayId ? { program, dayId, onChanged } : undefined;
  };
  const next = useMemo(() => nextWorkout(data), [data]);

  // If there's an active workout in progress, the hero is in "Resume" state
  if (activeWorkout) {
    const workingSets = activeWorkout.exercises.flatMap(e => e.sets).filter(s => !s.warmup);
    const doneCount = workingSets.filter(s => s.done).length;
    const totalCount = workingSets.length;
    const isPaused = Boolean(activeWorkout.pausedAt);

    // Get credited muscles from active workout
    const planned = activeWorkout.exercises.map(e => ({
      exerciseId: e.exerciseId,
      sourceName: e.name,
      name: e.name,
      sets: e.sets.map(s => ({ warmup: Boolean(s.warmup) }))
    }));
    const muscleSummary = getPlannedMuscleCredits(planned, data.exercises);
    const topMuscles = (data.workoutHero?.sessionId === activeWorkout.id && data.workoutHero.sessionRevision === activeWorkout.revision
      ? data.workoutHero.muscles : muscleSummary.muscles).slice(0, 3);

    return (
      <section className="panel next-workout-hero is-active" aria-label="Active workout in progress">
        <div className="hero-eyebrow">
          <span className={`hero-status-pill ${isPaused ? 'paused-pill' : 'active-pill'}`}>
            {isPaused ? 'Workout paused' : 'In progress'}
          </span>
          {program && <span className="hero-program-pill">{program.name}</span>}
        </div>

        <div className="hero-body">
          <div className="hero-meta-col">
            <h2 className="hero-title">{activeWorkout.name}</h2>
            <div className="hero-factual-counts">
              <span className="hero-count-item">
                <WorkoutElapsed session={activeWorkout} finishedAt={null} />
              </span>
              <span className="hero-count-item">
                <strong>{doneCount}</strong> of <strong>{totalCount}</strong> sets done
              </span>
              <span className="hero-count-item">
                <strong>{activeWorkout.exercises.length}</strong> exercises
              </span>
            </div>
          </div>

          <HeroMuscles muscles={topMuscles} />
        </div>

        <div className="hero-footer">
          <Button variant="primary" className="hero-action-btn" aria-label={`Resume ${activeWorkout.name}`} onClick={onResume}>
            <Play size={16} fill="currentColor" aria-hidden="true" />
            Resume workout
          </Button>
        </div>
      </section>
    );
  }

  // If a program is active or templates exist, show next workout or rest day
  if (next) {
    const isRest = 'isRestDay' in next && Boolean(next.isRestDay);

    if (isRest) {
      return (
        <RestDayHero
          programName={program?.name}
          title={next.name || 'Rest & Recovery'}
          onProgram={onProgram}
          pass={passRest(next.id)}
        />
      );
    }

    // Planned workout day
    const exerciseCount = 'exerciseCount' in next ? next.exerciseCount : ('exercises' in next ? next.exercises.length : 0);
    const focus = 'focus' in next && next.focus ? next.focus : null;
    const week = 'week' in next ? next.week : (program?.progress?.currentWeek ?? 1);

    // Muscle crops and working sets if template exercises are known
    let topMuscles: { muscle: string; sets: number }[] = [];
    let plannedWorkingSetsCount: number | null = null;
    if (data.workoutHero?.templateId === next.id && !data.workoutHero.sessionId) {
      plannedWorkingSetsCount = data.workoutHero.workingSets;
      topMuscles = data.workoutHero.muscles.slice(0, 3);
    }
    const fullTemplate = ('exercises' in next && Array.isArray(next.exercises) && next.exercises.length > 0)
      ? next
      : data.templates?.find(t => t.id === next.id);

    if (fullTemplate && Array.isArray(fullTemplate.exercises) && fullTemplate.exercises.length > 0) {
      const planned = fullTemplate.exercises.map(e => ({
        exerciseId: e.exerciseId,
        sourceName: e.name || e.sourceName,
        name: e.name,
        sets: e.sets.map(s => ({ warmup: Boolean(s.warmup) }))
      }));
      const summary = getPlannedMuscleCredits(planned, data.exercises);
      topMuscles = summary.muscles.slice(0, 3);
      plannedWorkingSetsCount = fullTemplate.exercises.flatMap(e => e.sets).filter(s => !s.warmup).length;
    }

    return (
      <section className="panel next-workout-hero" aria-label="Next planned workout">
        <div className="hero-eyebrow">
          <span className="hero-status-pill planned-pill">
            Next workout
          </span>
          {program ? (
            <span className="hero-program-pill">{program.name} · Week {week}</span>
          ) : focus ? (
            <span className="hero-program-pill">{focus}</span>
          ) : null}
        </div>

        <div className="hero-body">
          <div className="hero-meta-col">
            <h2 className="hero-title">{next.name}</h2>
            <div className="hero-factual-counts">
              {exerciseCount > 0 && (
                <span className="hero-count-item">
                  <strong>{exerciseCount}</strong> {exerciseCount === 1 ? 'exercise' : 'exercises'}
                </span>
              )}
              {plannedWorkingSetsCount !== null && (
                <span className="hero-count-item">
                  <strong>{plannedWorkingSetsCount}</strong> working {plannedWorkingSetsCount === 1 ? 'set' : 'sets'}
                </span>
              )}
              {focus && (
                <span className="hero-count-item hero-focus-text">
                  Target: <strong>{focus}</strong>
                </span>
              )}
            </div>
          </div>

          <HeroMuscles muscles={topMuscles} />
        </div>

        <div className="hero-footer">
          <Button variant="primary" className="hero-action-btn" onClick={() => onStart(next.id)}>
            <Play size={16} fill="currentColor" aria-hidden="true" />
            Start workout
          </Button>
        </div>
      </section>
    );
  }

  // Program completed state
  if (program && program.lifecycleStatus === 'completed') {
    return (
      <HeroStatusCard
        ariaLabel="Program completed"
        variant="is-finished"
        statusClass="finished-pill"
        statusLabel="Program finished"
        title={program.name}
        description="This program cycle has finished. Review your schedule, restart the cycle, or choose another program."
        actionLabel="Choose next program"
        actionVariant="primary"
        onAction={onProgram}
      />
    );
  }

  // Active program with no pending workouts in current week
  if (program && program.active) {
    const currentWeek = program.progress?.currentWeek ?? 1;

    // Scope progress days to authoritative current week
    let weekProgressDays = program.progress?.days ?? [];
    if (program.days && program.days.length > 0) {
      const currentWeekTemplateIds = new Set(program.days.filter(d => d.week === currentWeek).map(d => d.id));
      weekProgressDays = weekProgressDays.filter(d => currentWeekTemplateIds.has(d.templateId));
    }

    if (program.progress && weekProgressDays.length > 0) {
      const trainingDays = weekProgressDays.filter(d => !d.isRestDay);
      const pendingRest = weekProgressDays.find(d => d.status === 'pending' && d.isRestDay);
      const completedCount = trainingDays.filter(d => d.status === 'completed').length;
      const skippedCount = trainingDays.filter(d => d.status === 'skipped').length;
      const pendingCount = trainingDays.filter(d => d.status === 'pending').length;

      // Rest-only week: empty/rest-only every() must never assert workout completion
      if (trainingDays.length === 0) {
        return (
          <RestDayHero
            programName={program.name}
            week={currentWeek}
            title={`Week ${currentWeek} rest`}
            description="Scheduled rest week. Training resumes next week."
            onProgram={onProgram}
            pass={passRest(pendingRest?.templateId)}
          />
        );
      }

      if (pendingRest && pendingCount === 0) {
        return (
          <RestDayHero
            programName={program.name}
            week={currentWeek}
            onProgram={onProgram}
            pass={passRest(pendingRest.templateId)}
          />
        );
      }

      if (pendingCount === 0) {
        if (completedCount === trainingDays.length) {
          return (
            <HeroStatusCard
              ariaLabel="Week workouts completed"
              variant="is-finished"
              statusClass="finished-pill"
              statusLabel={`Week ${currentWeek} complete`}
              programBadge={program.name}
              title={`Week ${currentWeek} workouts complete`}
              description={`All planned workouts completed for week ${currentWeek}.`}
              actionLabel="View program schedule"
              actionVariant="secondary"
              onAction={onProgram}
            />
          );
        }

        if (skippedCount > 0) {
          return (
            <HeroStatusCard
              ariaLabel="Week workouts concluded"
              variant="is-finished"
              statusClass="finished-pill"
              statusLabel={`Week ${currentWeek} concluded`}
              programBadge={program.name}
              title={`Week ${currentWeek} sessions concluded`}
              description={`Week ${currentWeek} training sessions are done (${completedCount} completed, ${skippedCount} skipped).`}
              actionLabel="View program schedule"
              actionVariant="secondary"
              onAction={onProgram}
            />
          );
        }
      }
    }

    // Missing progress remains unknown with active-program View schedule fallback rather than Choose program
    return (
      <HeroStatusCard
        ariaLabel="Active program"
        statusClass="planned-pill"
        statusLabel="Active program"
        programBadge={`${program.name} · Week ${currentWeek}`}
        title={program.name}
        description="Program is active, but progress details are unavailable."
        actionLabel="View program schedule"
        actionVariant="secondary"
        onAction={onProgram}
      />
    );
  }

  // Active standalone completed state: only if full templates are loaded with an active completed standalone
  const completedStandalone = data.templates?.find(t => t.active && !t.programId && Boolean(t.activeCompletedAt));
  const completedName = completedStandalone?.name ?? data.workoutHero?.completedStandaloneName;
  if (completedName) {
    return (
      <HeroStatusCard
        ariaLabel="Active workout completed"
        variant="is-finished"
        statusClass="finished-pill"
        statusLabel="Workout complete"
        title={completedName}
        description="Restart this workout or choose another from your library."
        actionLabel="View workouts"
        actionVariant="secondary"
        onAction={onProgram}
      />
    );
  }

  // No active program and no template state
  return (
    <HeroStatusCard
      ariaLabel="Ready to train"
      variant="is-empty"
      statusClass="empty-pill"
      statusLabel="Get started"
      title="Ready to train?"
      description="Choose a workout or create a program."
      actionLabel="Explore workouts"
      actionVariant="primary"
      onAction={onProgram}
    />
  );
}
