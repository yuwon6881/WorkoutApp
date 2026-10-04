import { Loader2 } from 'lucide-react';
import { Skeleton } from './ui/Skeleton';
import './WorkoutStarting.css';

export function WorkoutStartingContent({ name, status = 'Starting workout…' }: {
  name: string;
  status?: string;
}) {
  return (
    <>
      <div className="workout-top-status-bar" data-sheet-handle="">
        <div className="workout-starting-title">
          <h2>{name}</h2>
          <span className="workout-starting-status" role="status"><Loader2 size={14} className="spin" />{status}</span>
        </div>
      </div>
      <div className="workout-body workout-starting-body" aria-hidden="true">
        <Skeleton className="workout-starting-strip" />
        <Skeleton className="workout-starting-heading" />
        <Skeleton className="workout-starting-card" />
        <Skeleton className="workout-starting-row" />
        <Skeleton className="workout-starting-row" />
        <Skeleton className="workout-starting-row" />
      </div>
    </>
  );
}
