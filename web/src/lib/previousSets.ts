import type { LoggedSet, RecentExerciseSession, SessionExercise } from '../types';
import { showSetDuration } from './setDuration';
import { effortValue } from './workoutDraft';

/// What one finished set read last time: "8 · 2 RIR", just the reps for a warm-up or when reps in
/// reserve is not tracked, or the time for a hold. A set with nothing recorded stays absent.
function summarize(set: LoggedSet, timed: boolean, trackRir: boolean): string | null {
  if (timed) return set.durationSeconds == null ? null : showSetDuration(set.durationSeconds);
  if (set.reps === null) return null;
  const rir = set.warmup ? null : set.rir ?? effortValue(set);
  return trackRir && rir !== null ? `${set.reps} · ${rir} RIR` : String(set.reps);
}

/// The most recent finished session's matching set for every row of this exercise, so a row can
/// show what the lifter did there last time. Warm-ups line up with warm-ups and working sets with
/// working sets; a row with no counterpart (a new set, or no history) is null so the caller can
/// fall back to the plan's target instead of inventing a number.
export function previousSetSummaries(
  sessions: RecentExerciseSession[],
  exercise: Pick<SessionExercise, 'exerciseId' | 'sets' | 'prescription' | 'trackingMode'>,
  trackRir: boolean
): Array<string | null> {
  const last = exercise.exerciseId
    ? sessions.find(session => session.exercises.some(item => item.exerciseId === exercise.exerciseId))
    : undefined;
  const finished = last?.exercises
    .filter(item => item.exerciseId === exercise.exerciseId)
    .flatMap(item => item.sets.filter(set => set.done)) ?? [];
  const previous = {
    warmup: finished.filter(set => set.warmup),
    working: finished.filter(set => !set.warmup)
  };
  const timed = exercise.trackingMode === 'duration';
  const seen = { warmup: 0, working: 0 };

  return exercise.sets.map((set, index) => {
    const kind = set.warmup || exercise.prescription[index]?.warmup ? 'warmup' : 'working';
    const match = previous[kind][seen[kind]];
    seen[kind] += 1;
    return match ? summarize(match, timed, trackRir) : null;
  });
}
