import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import type { Session } from '../types';
import { restTimer, remainingRestSeconds } from '../lib/restTimer';
import { restPhase, restShareLeft } from '../lib/restDisplay';
import { firstOpenExercise } from '../lib/workoutLogging';
import { showClock } from '../lib/training';
import { useVisibleClock } from '../lib/useVisibleClock';

/// Where the open workout stands, for the Overview's in-progress card: the exercise the lifter is
/// on with its next set, and the running rest draining beside it. The rest belongs to the shell's
/// timer (app/useShellRestTimer.ts), so this only reads it; it never starts or changes one.
export function ActiveWorkoutNow({ session }: { session: Session }) {
  const [rest, setRest] = useState(restTimer.current);
  useEffect(() => {
    setRest(restTimer.current);
    return restTimer.subscribe(setRest);
  }, []);
  const now = useVisibleClock(rest.endsAt > Date.now());
  const exercise = session.exercises[firstOpenExercise(session)];
  if (!exercise) return null;
  const working = exercise.sets.filter(set => !set.warmup);
  const nextWorking = working.findIndex(set => !set.done);
  const allDone = session.exercises.every(item => item.sets.every(set => set.done));
  const step = allDone ? 'Every set logged' : nextWorking >= 0 ? `Set ${nextWorking + 1} of ${working.length}` : 'Warm-up';
  const resting = restPhase(rest, now) === 'running';

  return (
    <div className="hero-now">
      <div className="hero-now-text">
        <span className="hero-now-label">{allDone ? 'Ready to finish' : 'Up now'}</span>
        <strong>{allDone ? session.name : exercise.name}</strong>
        <span className="hero-now-step">{step}</span>
      </div>
      {resting && (
        <span className="hero-now-rest" role="timer" aria-label={`Rest, ${showClock(remainingRestSeconds(rest, now))} left`}>
          <Timer size={15} aria-hidden="true" />
          <span>{showClock(remainingRestSeconds(rest, now))}</span>
          <span className="hero-now-track" aria-hidden="true">
            <span style={{ transform: `scaleX(${restShareLeft(rest, now)})` }} />
          </span>
        </span>
      )}
    </div>
  );
}
