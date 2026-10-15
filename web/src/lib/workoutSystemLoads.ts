import type { Session } from '../types';
import { resistanceModeFor } from './resistanceVariant';

// Mirror WorkoutService.ComputeSystemLoad using only the session's frozen reference. A server
// suggestion or acknowledgement may describe an older entry; neither can supply this total.
export function withSessionSystemLoads(session: Session): Session {
  const reference = session.bodyWeight?.referenceKg;
  let changed = false;
  const exercises = session.exercises.map(exercise => {
    if (exercise.loadModel !== 'full_bodyweight') return exercise;
    const resistanceMode = resistanceModeFor(exercise.loadModel, exercise.name);
    let exerciseChanged = false;
    const sets = exercise.sets.map(set => {
      const systemLoadKg = reference == null ? null
        : resistanceMode === 'bodyweight' ? reference
        : set.weightKg == null ? null
        : resistanceMode === 'added' ? reference + set.weightKg
        : Math.max(0, reference - set.weightKg);
      if (set.systemLoadKg === systemLoadKg && set.resistanceMode === resistanceMode) return set;
      exerciseChanged = true;
      return { ...set, systemLoadKg, resistanceMode };
    });
    if (!exerciseChanged) return exercise;
    changed = true;
    return { ...exercise, sets };
  });
  return changed ? { ...session, exercises } : session;
}
