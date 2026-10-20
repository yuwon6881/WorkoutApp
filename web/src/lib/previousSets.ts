import type { LoggedSet, RecentExerciseSession, SessionExercise, Unit } from '../types';
import { loadEntryFor } from './resistanceVariant';
import { showSetDuration } from './setDuration';
import { showExerciseWeight } from './weightBasis';
import { effortValue } from './workoutDraft';
import { setKind, type SetKind } from './workoutSetTypes';

type SummarizedExercise = Pick<SessionExercise, 'exerciseId' | 'sets' | 'prescription' | 'trackingMode' | 'name' | 'loadModel' | 'weightBasis'>;

/// The weight a finished set was lifted with, as the set row enters it: "15 kg/side", "+10 kg" for
/// added load, "20 kg assist", "BW" for a plain bodyweight movement. Null when there is none to show.
function loadText(set: LoggedSet, exercise: SummarizedExercise, unit: Unit): string | null {
  const entry = loadEntryFor(exercise);
  if (entry === 'bodyweight') return 'BW';
  if (entry === 'none' || set.weightKg === null) return null;
  const weight = showExerciseWeight(set.weightKg, unit, exercise);
  return entry === 'added' ? `+${weight}` : entry === 'assistance' ? `${weight} assist` : weight;
}

/// What one finished set read last time: "15 kg × 8 · 2 RIR", without the reserve for a warm-up or
/// when reps in reserve is not tracked, and "40 kg · 0:45" for a hold. The reps alone stand when no
/// weight was logged, and a set with nothing recorded stays absent.
function summarize(set: LoggedSet, exercise: SummarizedExercise, unit: Unit, trackRir: boolean): string | null {
  const load = loadText(set, exercise, unit);
  if (exercise.trackingMode === 'duration') {
    const time = set.durationSeconds == null ? null : showSetDuration(set.durationSeconds);
    return [load === 'BW' ? null : load, time].filter(Boolean).join(' · ') || null;
  }
  if (set.reps === null) return null;
  const done = load ? `${load} × ${set.reps}` : String(set.reps);
  const rir = set.warmup ? null : set.rir ?? effortValue(set);
  return trackRir && rir !== null ? `${done} · ${rir} RIR` : done;
}

/// The most recent finished session's matching set for every row of this exercise, so a row can
/// show what the lifter did there last time. Each kind lines up with its own kind: warm-ups with
/// warm-ups, a technique (myo-reps, drop sets, partials) with the same technique, and straight sets
/// with straight sets, so changing a set's type changes what it is compared with. A row with no
/// counterpart (a new set, or no history) is null so the caller can fall back to the plan's target
/// instead of inventing a number.
export function previousSetSummaries(
  sessions: RecentExerciseSession[],
  exercise: SummarizedExercise,
  trackRir: boolean,
  unit: Unit
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
  const seen = new Map<SetKind, number>();

  return exercise.sets.map((set, index) => {
    const kind = setKind(set, exercise.prescription[index]);
    const position = seen.get(kind) ?? 0;
    seen.set(kind, position + 1);
    const match = previous.get(kind)?.[position];
    return match ? summarize(match, exercise, unit, trackRir) : null;
  });
}
