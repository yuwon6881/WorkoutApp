import type { LucideIcon } from 'lucide-react';
import { Clock3, Dumbbell, Layers } from 'lucide-react';
import type { DraftExercise } from '../types';

type SummaryTone = 'accent' | 'teal' | 'amber';

function SummaryTile({ icon: Icon, tone, value, unit, label, title }: {
  icon: LucideIcon;
  tone: SummaryTone;
  value: string;
  unit?: string;
  label: string;
  title?: string;
}) {
  return <div className="workout-preview-tile" data-tone={tone} title={title}>
    <span className="workout-preview-tile-icon" aria-hidden="true"><Icon size={16} /></span>
    <span className="workout-preview-tile-text">
      <strong>{value}{unit && <small> {unit}</small>}</strong>
      <span>{label}</span>
    </span>
  </div>;
}

/// The day at a glance before Start: approximate length, exercises and working sets, as tiles
/// rather than a sentence. When the plan prints rest ranges the estimate uses their average, which
/// the workout menu can change; that stays in the tile's title and accessible name, not on screen.
export function WorkoutPreviewSummary({ exercises, minutes, restRange }: {
  exercises: DraftExercise[];
  minutes: number | null;
  restRange: boolean;
}) {
  const workingSets = exercises.reduce((total, exercise) => total + exercise.sets.filter(set => !set.warmup).length, 0);
  const restNote = restRange
    ? 'At the average of the printed rests; choose Minimal or Maximal in the workout menu'
    : 'At the planned rests';
  return <div className="workout-preview-summary" role="group" aria-label="Workout summary">
    <SummaryTile icon={Clock3} tone="amber" value={minutes === null ? '—' : `~${minutes}`} unit={minutes === null ? undefined : 'min'}
      label="Est. time" title={minutes === null ? undefined : restNote} />
    <SummaryTile icon={Dumbbell} tone="accent" value={String(exercises.length)}
      label={exercises.length === 1 ? 'Exercise' : 'Exercises'} />
    <SummaryTile icon={Layers} tone="teal" value={String(workingSets)}
      label={workingSets === 1 ? 'Working set' : 'Working sets'} />
    {minutes !== null && <span className="sr-only">{`About ${minutes} minutes. ${restNote}.`}</span>}
  </div>;
}
