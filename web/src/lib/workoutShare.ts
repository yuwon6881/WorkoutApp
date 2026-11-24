import type { Session } from '../types';

/// The share of a session's working sets already logged, from 0 to 1 (0 with none planned).
export function loggedWorkingShare(session: Session): number {
  const working = session.exercises.flatMap(exercise => exercise.sets).filter(set => !set.warmup);
  return working.length ? working.filter(set => set.done).length / working.length : 0;
}
