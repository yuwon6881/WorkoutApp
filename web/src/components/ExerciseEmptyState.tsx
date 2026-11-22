import { History, Medal, TrendingUp, type LucideIcon } from 'lucide-react';
import './ExerciseEmptyState.css';

type Tone = 'accent' | 'amber' | 'teal';

const progressPreview: { icon: LucideIcon; tone: Tone; label: string; detail: string }[] = [
  { icon: TrendingUp, tone: 'accent', label: 'Progress chart', detail: 'Estimated 1RM, load, volume and reps over time' },
  { icon: Medal, tone: 'amber', label: 'Personal records', detail: 'Heaviest load, best set and rep PR' },
  { icon: History, tone: 'teal', label: 'Session history', detail: 'Every set from each workout, newest first' }
];

/// Shown while an exercise has never been logged. A faint, flat chart sketch keeps the room the real
/// chart will fill, and the three rows name what a first logged workout unlocks, so the page reads
/// as "not started yet" instead of broken. Nothing here is data: no figure is invented.
export function ExerciseProgressEmpty({ exerciseName }: { exerciseName: string }) {
  return <section className="exercise-empty" aria-label="No workout history yet">
    <div className="exercise-empty-sketch" aria-hidden="true">
      <svg viewBox="0 0 320 96" preserveAspectRatio="none" focusable="false">
        <g className="exercise-empty-grid">
          <line x1="0" y1="16" x2="320" y2="16" />
          <line x1="0" y1="48" x2="320" y2="48" />
          <line x1="0" y1="80" x2="320" y2="80" />
        </g>
        <polyline className="exercise-empty-line" points="8,76 70,62 128,66 190,40 250,46 312,18" />
      </svg>
      <span className="exercise-empty-badge"><TrendingUp size={18} /></span>
    </div>
    <div className="exercise-empty-copy">
      <h3>Not logged yet</h3>
      <p>Complete a workout with {exerciseName} and your progress starts building here.</p>
    </div>
    <ul className="exercise-empty-list">
      {progressPreview.map(({ icon: Icon, tone, label, detail }) => <li key={label} data-tone={tone}>
        <span className="exercise-empty-icon"><Icon size={17} /></span>
        <span className="exercise-empty-text"><strong>{label}</strong><small>{detail}</small></span>
      </li>)}
    </ul>
  </section>;
}

/// The History tab's counterpart: a single short message, since the Progress tab already shows
/// what logging unlocks.
export function ExerciseHistoryEmpty() {
  return <section className="exercise-empty exercise-empty-compact" aria-label="No workout history yet">
    <span className="exercise-empty-badge"><History size={22} /></span>
    <div className="exercise-empty-copy">
      <h3>No sessions yet</h3>
      <p>Each workout you complete with this exercise is listed here, with every set you logged.</p>
    </div>
  </section>;
}
