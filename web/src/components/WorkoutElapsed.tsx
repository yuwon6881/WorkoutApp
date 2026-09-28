import { Clock3 } from 'lucide-react';
import type { Session } from '../types';
import { showDuration } from '../lib/training';
import { useVisibleClock } from '../lib/useVisibleClock';

export function WorkoutElapsed({ session, finishedAt }: {
  session: Pick<Session, 'startedAt' | 'pausedAt' | 'pausedSeconds'>;
  finishedAt: string | null;
}) {
  const now = useVisibleClock(!session.pausedAt && !finishedAt);
  const at = finishedAt ? Date.parse(finishedAt) : session.pausedAt ? Date.parse(session.pausedAt) : now;
  const openPause = session.pausedAt ? Math.max(0, Math.floor((at - Date.parse(session.pausedAt)) / 1000)) : 0;
  const elapsed = Math.max(0, Math.floor((at - Date.parse(session.startedAt)) / 1000) - (session.pausedSeconds ?? 0) - openPause);
  return <span className="workout-elapsed-clock" role="timer" aria-label={`Active time ${showDuration(elapsed)}`}>
    <Clock3 size={14} aria-hidden="true" />{showDuration(elapsed)}
  </span>;
}
