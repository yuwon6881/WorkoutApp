import { Minus, Plus, Repeat, TrendingDown, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SessionExercise, Unit } from '../types';
import { progressionChange, type ProgressionChange } from '../lib/progressionChange';
import { showWeight } from '../lib/training';
import { showExerciseWeight, weightUnit } from '../lib/weightBasis';

type Tone = 'up' | 'hold' | 'down';

function describe(change: ProgressionChange, unit: Unit): { icon: LucideIcon; text: string; spoken: string; tone: Tone } {
  switch (change.kind) {
    case 'load-up':
      return { icon: TrendingUp, text: `+${showWeight(change.deltaKg, unit)}`, spoken: `add ${showWeight(change.deltaKg, unit)}`, tone: 'up' };
    case 'load-down':
      return { icon: TrendingDown, text: `−${showWeight(change.deltaKg, unit)}`, spoken: `${showWeight(change.deltaKg, unit)} lighter`, tone: 'down' };
    case 'reps-up': {
      const reps = `${change.deltaReps} rep${change.deltaReps === 1 ? '' : 's'}`;
      return { icon: Plus, text: `+${reps}`, spoken: `add ${reps}`, tone: 'up' };
    }
    case 'reps-down': {
      const reps = `${change.deltaReps} fewer rep${change.deltaReps === 1 ? '' : 's'}`;
      return { icon: Minus, text: reps, spoken: reps, tone: 'down' };
    }
    case 'repeat':
      return { icon: Repeat, text: 'Repeat', spoken: 'repeat last time', tone: 'hold' };
  }
}

/// What today's suggestion changes for the set the lifter is on: more weight, more reps, a repeat,
/// or easing off, rather than always an upward arrow. A timed movement only reports load changes,
/// since its suggestion does not count reps. With nothing to compare against there is no badge.
export function ProgressionChangeBadge({ exercise, unit }: { exercise: SessionExercise; unit: Unit }) {
  const working = exercise.sets.filter(set => !set.warmup);
  const current = working.find(set => !set.done && set.suggestion) ?? working.find(set => set.suggestion);
  const change = progressionChange(current?.suggestion);
  if (!change || (exercise.trackingMode === 'duration' && (change.kind === 'reps-up' || change.kind === 'reps-down'))) return null;
  const { icon: Icon, text, spoken, tone } = describe(change, unit);
  const reason = current?.suggestion?.reason ?? '';
  return (
    <div className={`workout-progression-badge progression-${tone}`} title={reason} role="note"
      aria-label={`Suggestion: ${spoken.replace(unit, weightUnit(unit, exercise))}. ${reason}`.trim()}>
      <span className="badge-weight"><Icon size={14} aria-hidden="true" />{text.replace(unit, weightUnit(unit, exercise))}</span>
      {exercise.progression?.trendE1rmKg != null && (
        <span className="badge-sub">e1RM {showExerciseWeight(exercise.progression.trendE1rmKg, unit, exercise)}</span>
      )}
    </div>
  );
}
