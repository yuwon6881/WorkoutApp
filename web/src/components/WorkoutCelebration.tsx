import { Trophy } from 'lucide-react';

/** A personal best set by the set just logged: what kind of best, then the exercise and numbers. */
export type Celebration = { id: number; title: string; detail: string };

/// Floats over the top of the workout, just under its header, for a few seconds after a record set
/// (useAfterLog.ts). It takes no space and lets taps through, so the sets never move under a thumb;
/// the live region stays mounted so each new best is announced.
export function WorkoutCelebration({ celebration }: { celebration: Celebration | null }) {
  return (
    <div className="workout-celebration-anchor" role="status" aria-live="polite">
      {celebration && (
        <div className="workout-celebration" key={celebration.id}>
          <span className="workout-celebration-icon"><Trophy size={18} aria-hidden="true" /></span>
          <span className="workout-celebration-text">
            <strong>{celebration.title}</strong>
            <span>{celebration.detail}</span>
          </span>
        </div>
      )}
    </div>
  );
}
