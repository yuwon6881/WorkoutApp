import { Loader2 } from 'lucide-react';
import { Skeleton } from './ui/Skeleton';
import './WorkoutStarting.css';

/// Mirrors the active workout's header (title, a status line where the clock sits, and the three
/// header actions), its exercise strip band, and the first exercise, so the real sheet replaces it
/// without the title rewrapping or the content below moving.
export function WorkoutStartingContent({ name, status = 'Starting workout…' }: {
  name: string;
  status?: string;
}) {
  return (
    <>
      <div className="workout-top-status-bar workout-starting-part" data-sheet-handle="">
        <div className="workout-starting-title">
          <h2>{name}</h2>
          <span className="workout-starting-status" role="status"><Loader2 size={14} className="spin" />{status}</span>
        </div>
        <div className="workout-top-actions" aria-hidden="true">
          <Skeleton className="workout-starting-icon" />
          <Skeleton className="workout-starting-icon" />
          <Skeleton className="workout-starting-icon" />
        </div>
      </div>
      <div className="workout-exercise-strip-container workout-starting-part" aria-hidden="true">
        <div className="workout-exercise-strip">
          <Skeleton className="workout-starting-strip" />
        </div>
      </div>
      <div className="workout-body workout-starting-body workout-starting-part" aria-hidden="true">
        <Skeleton className="workout-starting-heading" />
        <Skeleton className="workout-starting-card" />
        <Skeleton className="workout-starting-row" />
        <Skeleton className="workout-starting-row" />
        <Skeleton className="workout-starting-row" />
      </div>
    </>
  );
}
