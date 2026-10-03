import type { LoggedSet, RecentExerciseSession, SessionExercise } from '../types';
import { showSetDuration } from './setDuration';
import { effortValue } from './workoutDraft';
import { setKind, type SetKind } from './workoutSetTypes';

/// What one finished set read last time: "8 · 2 RIR", just the reps for a warm-up or when reps in
/// reserve is not tracked, or the time for a hold. A set with nothing recorded stays absent.
function summarize(set: LoggedSet, timed: boolean, trackRir: boolean): string | null {
  if (timed) return set.durationSeconds == null ? null : showSetDuration(set.durationSeconds);
  if (set.reps === null) return null;
  const rir = set.warmup ? null : set.rir ?? effortValue(set);
  return trackRir && rir !== null ? `${set.reps} · ${rir} RIR` : String(set.reps);
}

/// The most recent finished session's matching set for every row of this exercise, so a row can
/// show what the lifter did there last time. Each kind lines up with its own kind: warm-ups with
/// warm-ups, a technique (myo-reps, drop sets, partials) with the same technique, and straight sets
/// with straight sets, so changing a set's type changes what it is compared with. A row with no
/// counterpart (a new set, or no history) is null so the caller can fall back to the plan's target
/// instead of inventing a number.
export function previousSetSummaries(
  sessions: RecentExerciseSession[],
  exercise: Pick<SessionExercise, 'exerciseId' | 'sets' | 'prescription' | 'trackingMode'>,
  trackRir: boolean
): Array<string | null> {
  const last = exercise.exerciseId
    ? sessions.find(session => session.exercises.some(item => item.exerciseId === exercise.exerciseId))
    : undefined;
  const previous = new Map<SetKind, LoggedSet[]>();
  for (const item of last?.exercises.filter(entry => entry.exerciseId === exercise.exerciseId) ?? []) {
    for (const set of item.sets.filter(entry => entry.done)) {
      const kind: SetKind = set.warmup ? 'warmup' : (item.techniques?.[set.position] as SetKind | null | undefined) ?? 'straight';
      previous.set(kind, [...(previous.get(kind) ?? []), set]);
    }
  }
  const timed = exercise.trackingMode === 'duration';
  const seen = new Map<SetKind, number>();

  return exercise.sets.map((set, index) => {
    const kind = setKind(set, exercise.prescription[index]);
    const position = seen.get(kind) ?? 0;
    seen.set(kind, position + 1);
    const match = previous.get(kind)?.[position];
    return match ? summarize(match, timed, trackRir) : null;
  });
}
