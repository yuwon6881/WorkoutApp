import { ChevronUp, Pause, Play, Timer } from 'lucide-react';
import { useVisibleClock } from '../lib/useVisibleClock';
import type { RestState } from '../lib/restTimer';
import type { Session } from '../types';
import { showClock } from '../lib/training';
import { Button } from './ui/Button';
import { WorkoutElapsed } from './WorkoutElapsed';

/// The minimized workout: a slim bar above the navigation, like a music app's mini player. It keeps
/// the clock, logged sets and any rest in view, fills a line with the logged share, and reopens the
/// workout sheet on a tap.
export function ResumeWorkoutButton({ session, rest, onResume }: { session: Session; rest: RestState; onResume: () => void }) {
  const now = useVisibleClock(rest.endsAt > Date.now());
  const running = rest.endsAt > now;
  const remaining = Math.max(0, Math.ceil((running ? rest.endsAt - now : rest.pausedRemainingMs) / 1000));
  const sets = session.exercises.flatMap(exercise => exercise.sets).filter(set => !set.warmup);
  const done = sets.filter(set => set.done).length;
  const paused = Boolean(session.pausedAt);
  return (
    <Button className={`resume-workout ${remaining > 0 ? 'resting' : ''}`.trim()} variant="secondary" aria-label={`Resume ${session.name}`} onClick={onResume}>
      <span className="resume-icon" aria-hidden="true">
        {remaining > 0 ? <Timer size={19} /> : paused ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
      </span>
      <span className="resume-summary">
        <strong>{session.name}</strong>
        <span className="resume-metrics">
          {paused && <span className="resume-paused">Paused</span>}
          <WorkoutElapsed session={session} finishedAt={null} />
          <span>{done}/{sets.length} sets</span>
          {remaining > 0 && <span className="resume-rest">{showClock(remaining)} rest{paused ? ' paused' : ''}</span>}
        </span>
      </span>
      <span className="resume-open" aria-hidden="true"><ChevronUp size={20} /></span>
      <span className="resume-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${sets.length ? done / sets.length : 0})` }} />
      </span>
    </Button>
  );
}
