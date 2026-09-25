import type { Session } from '../types';
import type { SetPatch, WorkoutOperation } from './workoutRecovery';

/// Coalesce only operations that have not been bound to a request. An already-bound operation
/// may have reached the server, so a later revert must be represented by a compensating patch.
export function reconcileSetPatchOperation(
  operations: WorkoutOperation[], setId: string, desired: SetPatch, baseline: SetPatch, createdAt: string
): void {
  const latestIndex = findLastIndex(operations, operation => operation.type === 'setPatch' && operation.setId === setId);
  const latest = latestIndex < 0 ? null : operations[latestIndex];
  const pendingIndex = findLastIndex(operations, operation => operation.type === 'setPatch' && operation.setId === setId && operation.revision === null);
  const desiredIsBaseline = JSON.stringify(desired) === JSON.stringify(baseline);

  if (desiredIsBaseline) {
    if (pendingIndex >= 0) operations.splice(pendingIndex, 1);
    const remainingLatestIndex = findLastIndex(operations, operation => operation.type === 'setPatch' && operation.setId === setId);
    const remainingLatest = remainingLatestIndex < 0 ? null : operations[remainingLatestIndex];
    if (remainingLatest?.type === 'setPatch' && remainingLatest.revision !== null && JSON.stringify(remainingLatest.patch) !== JSON.stringify(desired))
      operations.push({ id: crypto.randomUUID(), type: 'setPatch', setId, patch: desired, revision: null, createdAt });
    return;
  }

  if (pendingIndex >= 0) {
    const pending = operations[pendingIndex];
    if (pending.type === 'setPatch' && JSON.stringify(pending.patch) !== JSON.stringify(desired)) pending.patch = desired;
  } else if (!(latest?.type === 'setPatch' && JSON.stringify(latest.patch) === JSON.stringify(desired))) {
    operations.push({ id: crypto.randomUUID(), type: 'setPatch', setId, patch: desired, revision: null, createdAt });
  }
}

export function sameWorkoutEdits(left: Session, right: Session): boolean {
  const comparable = (session: Session) => ({
    id: session.id,
    active: session.active,
    finishedAt: session.finishedAt,
    pausedAt: session.pausedAt ?? null,
    pausedSeconds: session.pausedSeconds ?? 0,
    note: session.note,
    exercises: session.exercises.map(exercise => ({
      id: exercise.id, exerciseId: exercise.exerciseId, name: exercise.name, note: exercise.note,
      prescription: exercise.prescription, sequenceGroup: exercise.sequenceGroup, substitutions: exercise.substitutions,
      loadModel: exercise.loadModel, sourceTemplateExerciseId: exercise.sourceTemplateExerciseId,
      sourceSlotKey: exercise.sourceSlotKey, sourcePhaseId: exercise.sourcePhaseId, sourcePage: exercise.sourcePage,
      sets: exercise.sets.map(set => ({ id: set.id, weightKg: set.weightKg, reps: set.reps, rpe: set.rpe, rir: set.rir ?? null, done: set.done, warmup: set.warmup, resistanceMode: set.resistanceMode }))
    }))
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function sameWorkoutNonSetEdits(left: Session, right: Session): boolean {
  const comparable = (session: Session) => ({
    id: session.id, note: session.note,
    exercises: session.exercises.map(exercise => ({
      id: exercise.id, exerciseId: exercise.exerciseId, name: exercise.name, note: exercise.note,
      position: exercise.position, prescription: exercise.prescription, sequenceGroup: exercise.sequenceGroup,
      substitutions: exercise.substitutions, progression: exercise.progression, loadModel: exercise.loadModel,
      sourceTemplateExerciseId: exercise.sourceTemplateExerciseId, sourceSlotKey: exercise.sourceSlotKey,
      sourcePhaseId: exercise.sourcePhaseId, sourcePage: exercise.sourcePage,
      setIds: exercise.sets.map(set => set.id)
    }))
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index--) if (predicate(values[index])) return index;
  return -1;
}
