import type { Session } from '../types';
import type { WorkoutOperation, WorkoutRecoveryRecord } from './workoutRecovery';
import { findSetInSession } from './workoutRecoveryComparison';

export const PROMPT_DRAIN_MS = 250;
export const EDIT_DRAIN_MS = 1500;

/// Logging a set, rest, timing and structure changes reach the server and the watch at once,
/// while value typing is coalesced into one request because it is already durable on the device.
export function workoutDrainDelay(record: WorkoutRecoveryRecord): number {
  const unbound = record.operations.filter(operation => operation.revision === null);
  if (unbound.length === 0) return PROMPT_DRAIN_MS;
  return unbound.some(operation => isPromptOperation(operation, record.serverSession))
    ? PROMPT_DRAIN_MS
    : EDIT_DRAIN_MS;
}

function isPromptOperation(operation: WorkoutOperation, serverSession: Session): boolean {
  if (operation.type === 'rest' || operation.type === 'pause' || operation.type === 'resume' || operation.type === 'finish') {
    return true;
  }
  if (operation.type === 'setPatch') {
    if (operation.rest != null) return true;
    if (operation.patch.done !== undefined) {
      const serverSet = findSetInSession(serverSession, operation.setId);
      if (!serverSet || serverSet.done !== operation.patch.done) return true;
    }
    return false;
  }
  if (operation.type === 'save') {
    return hasStructuralOrCompletionDifference(operation.draft, serverSession);
  }
  return false;
}

function hasStructuralOrCompletionDifference(draft: Session, serverSession: Session): boolean {
  if (draft.exercises.length !== serverSession.exercises.length) return true;
  for (let i = 0; i < draft.exercises.length; i++) {
    const draftExercise = draft.exercises[i];
    const serverExercise = serverSession.exercises[i];
    if (draftExercise.id !== serverExercise.id) return true;
    if (draftExercise.sets.length !== serverExercise.sets.length) return true;
    for (let j = 0; j < draftExercise.sets.length; j++) {
      const draftSet = draftExercise.sets[j];
      const serverSet = serverExercise.sets[j];
      if (draftSet.id !== serverSet.id) return true;
      if (draftSet.done !== serverSet.done) return true;
    }
  }
  return false;
}
