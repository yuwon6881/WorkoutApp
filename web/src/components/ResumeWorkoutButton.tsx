import { Play, ArrowUpRight } from 'lucide-react';
import { useVisibleClock } from '../lib/useVisibleClock';
import type { RestState } from '../lib/restTimer';
import type { Session } from '../types';
import { showClock } from '../lib/training';
import { Button } from './ui/Button';
import { WorkoutElapsed } from './WorkoutElapsed';

export function ResumeWorkoutButton({ session, rest, onResume }: { session: Session; rest: RestState; onResume: () => void }) {
  const now = useVisibleClock(rest.endsAt > Date.now());
  const running = rest.endsAt > now;
  const remaining = Math.max(0, Math.ceil((running ? rest.endsAt - now : rest.pausedRemainingMs) / 1000));
  const sets = session.exercises.flatMap(exercise => exercise.sets).filter(set => !set.warmup);
  const done = sets.filter(set => set.done).length;
  return (
    <Button className="resume-workout" variant="secondary" aria-label={`Resume ${session.name}`} onClick={onResume}>
      <span className="resume-icon"><Play size={20} fill="currentColor" /></span>
      <span className="resume-summary">
        <span className="resume-label">{session.pausedAt ? 'Resume paused workout' : 'Resume workout'}</span>
        <strong>{session.name}</strong>
        <span className="resume-metrics"><WorkoutElapsed session={session} finishedAt={null} /> <span>{done}/{sets.length} sets</span>
          {remaining > 0 && <span>{showClock(remaining)} rest{session.pausedAt ? ' paused' : ''}</span>}
        </span>
      </span>
      <span className="resume-open">Resume <ArrowUpRight size={18} /></span>
    </Button>
  );
}
