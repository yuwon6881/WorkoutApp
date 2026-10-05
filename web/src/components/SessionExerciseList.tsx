import { Clock3, Trophy } from 'lucide-react';
import type { LoggedSet, SessionExercise, Unit } from '../types';
import { formatExercisePrBadge, formatSetPrTag } from '../lib/livePr';
import { showTimedSet } from '../lib/setDuration';
import { showActualRir, toDisplay } from '../lib/training';
import { useTrackRir } from '../lib/trackRir';

function setResult(set: LoggedSet, unit: Unit): string {
  if (set.durationSeconds != null) return showTimedSet(set, unit);
  return set.weightKg === null ? `${set.reps} reps` : `${toDisplay(set.weightKg, unit)} ${unit} × ${set.reps}`;
}

function SessionExerciseCard({ exercise, order, unit, trackRir }: {
  exercise: SessionExercise;
  order: number;
  unit: Unit;
  trackRir: boolean;
}) {
  const done = exercise.sets.filter(set => set.done);
  const working = done.filter(set => !set.warmup).length;
  return (
    <li className="session-exercise">
      <div className="session-exercise-header">
        <span className="session-exercise-order" aria-hidden="true">{order}</span>
        <div className="session-exercise-title">
          <h4>{exercise.name}</h4>
          <span className="session-exercise-subtitle">{working} working {working === 1 ? 'set' : 'sets'}</span>
        </div>
        {exercise.isPr && <span className="pill pill-accent pr-exercise-badge">
          <Trophy size={12} aria-hidden="true" /> {formatExercisePrBadge(exercise, unit)}
        </span>}
      </div>
      <ol className="session-summary-sets">
        {done.map((set, index) => {
          const number = done.slice(0, index + 1).filter(item => item.warmup === set.warmup).length;
          const effort = showActualRir(set.rir, set.rpe);
          const isTimed = set.durationSeconds != null;
          return <li key={set.id} className={`${set.warmup ? 'is-warmup' : ''}${set.isPr ? ' pr-set-row' : ''}`.trim() || undefined}>
            <span className="session-set-label">{set.warmup ? `Warm-up ${number}` : `Set ${number}`}</span>
            <span className="session-set-target">
              {isTimed && <Clock3 size={13} aria-hidden="true" className="session-set-timer-icon" />}
              <strong>{setResult(set, unit)}</strong>
            </span>
            <div className="session-set-tags">
              {trackRir && effort !== '—' && <span className="session-set-effort">{effort}</span>}
              {set.isPr && <span className="pill pill-accent pr-set-tag"><Trophy size={10} aria-hidden="true" /> {formatSetPrTag(set)}</span>}
            </div>
          </li>;
        })}
      </ol>
      {exercise.note && <p className="session-summary-note">{exercise.note}</p>}
    </li>
  );
}

/// Each logged exercise with its sets in the order they were done; nothing is shown for a set that
/// was never logged.
export function SessionExerciseList({ exercises, unit, loading }: {
  exercises: SessionExercise[];
  unit: Unit;
  loading: boolean;
}) {
  const trackRir = useTrackRir();
  const logged = exercises.filter(exercise => exercise.sets.some(set => set.done));
  return (
    <section className="session-section" aria-labelledby="session-exercises-heading">
      <div className="session-section-heading">
        <h3 id="session-exercises-heading">Exercises</h3>
        {!loading && <span className="session-section-count">{logged.length}</span>}
      </div>
      {loading ? (
        <div className="session-exercises" aria-busy="true" aria-label="Loading exercises">
          {[0, 1].map(index => <div className="session-exercise skeleton session-exercise-skeleton" key={index} aria-hidden="true" />)}
        </div>
      ) : (
        <ol className="session-exercises">
          {logged.map((exercise, index) => <SessionExerciseCard key={exercise.id} exercise={exercise}
            order={index + 1} unit={unit} trackRir={trackRir} />)}
        </ol>
      )}
    </section>
  );
}
