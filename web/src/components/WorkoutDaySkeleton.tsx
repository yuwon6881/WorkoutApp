import { Skeleton } from './ui/Skeleton';
import './ProgramMusclePreview.css';
import './ReadOnlyDay.css';
import './WorkoutDaySkeleton.css';

const MUSCLE_TILES = 6;
/// Set lines per exercise card: a day is mostly cards of one to three lines.
const EXERCISE_CARDS = [2, 1, 2];

/// The placeholder for a workout day whose details are still arriving: the "Muscles worked" tiles
/// and the exercise cards with their set lines, built from the real classes so the sheet keeps its
/// height and the content lands where its outline was. One polite status line names what loads;
/// the shapes are hidden from assistive technology.
export function WorkoutDaySkeleton({ label }: { label: string }) {
  return (
    <div className="workout-day-skeleton" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="draft-day-muscles" aria-hidden="true">
        <div className="program-muscle-preview">
          <div className="program-muscle-header">
            <h3 className="program-muscle-heading">Muscles worked</h3>
          </div>
          <div className="program-muscle-grid">
            {Array.from({ length: MUSCLE_TILES }, (_, index) => (
              <div key={index} className="program-muscle-item">
                <div className="program-muscle-tile workout-day-skeleton-tile">
                  <Skeleton className="program-muscle-figure" />
                  <span className="workout-day-skeleton-copy">
                    <Skeleton className="workout-day-skeleton-line" />
                    <Skeleton className="workout-day-skeleton-line workout-day-skeleton-line-short" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="readonly-day-exercises" aria-hidden="true">
        {EXERCISE_CARDS.map((lines, index) => (
          <div key={index} className="readonly-exercise workout-day-skeleton-card">
            <div className="readonly-exercise-head">
              <Skeleton className="workout-day-skeleton-name" />
              <Skeleton className="workout-day-skeleton-rest" />
            </div>
            <div className="readonly-exercise-sets">
              {Array.from({ length: lines }, (_, line) => <Skeleton key={line} className="workout-day-skeleton-set" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
