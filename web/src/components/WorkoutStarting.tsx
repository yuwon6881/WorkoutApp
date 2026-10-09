import { Loader2 } from 'lucide-react';
import { Skeleton } from './ui/Skeleton';
import './WorkoutSheet.css';
import './ActiveWorkout.css';
import './WorkoutStarting.css';

/// Mirrors the active workout's header (the name and its three actions, then the status row where
/// the clock sits), its exercise strip band, and the first exercise's heading, action pills and set
/// rows, so the real sheet replaces it without the title rewrapping or the content below moving.
export function WorkoutStartingContent({ name, status = 'Starting workout…' }: {
  name: string;
  status?: string;
}) {
  return (
    <>
      <div className="workout-top-status-bar workout-starting-part" data-sheet-handle="">
        <div className="workout-top-row">
          <h2 className="workout-top-title">{name}</h2>
          <div className="workout-top-actions" aria-hidden="true">
            <Skeleton className="workout-starting-icon" />
            <Skeleton className="workout-starting-icon" />
            <Skeleton className="workout-starting-icon" />
          </div>
        </div>
        <div className="workout-top-rail">
          <span className="workout-starting-status" role="status"><Loader2 size={16} className="spin" />{status}</span>
        </div>
      </div>
      <div className="workout-exercise-strip-container workout-starting-part" aria-hidden="true">
        <div className="workout-exercise-strip">
          <Skeleton className="workout-starting-strip" />
          <Skeleton className="workout-starting-strip" />
          <Skeleton className="workout-starting-strip" />
        </div>
      </div>
      <div className="modal-body workout-body workout-starting-body workout-starting-part" aria-hidden="true">
        <Skeleton className="workout-starting-heading" />
        <Skeleton className="workout-starting-subtitle" />
        <div className="workout-starting-pills">
          <Skeleton className="workout-starting-pill" />
          <Skeleton className="workout-starting-pill" />
        </div>
        <Skeleton className="workout-starting-row" />
        <Skeleton className="workout-starting-row" />
        <Skeleton className="workout-starting-row" />
        <Skeleton className="workout-starting-row" />
      </div>
    </>
  );
}
