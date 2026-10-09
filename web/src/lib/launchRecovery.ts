import type { Preferences, Session } from '../types';
import { refreshRecovery, sameWorkoutEdits, setConflict } from './workoutRecovery';
import type { WorkoutRecoveryRecord } from './workoutRecovery';

/// The app reopened on the workout this device already holds: decide whether its copy, the
/// server's, or a review of both is what the lifter sees.
export async function reconcileReopenedWorkout(
  local: WorkoutRecoveryRecord,
  server: Session,
  account: { id: string; displayName: string },
  preferences: Preferences
): Promise<WorkoutRecoveryRecord> {
  const hasPending = local.operations.length > 0;
  const operationWasSent = local.operations[0]?.revision !== null && local.operations[0] !== undefined;
  if (hasPending && !operationWasSent && local.serverSession.revision !== server.revision && !sameWorkoutEdits(local.serverSession, server)) {
    return await setConflict(account.id, true, server) ?? local;
  }
  if (!hasPending && !sameWorkoutEdits(local.draft, server) && local.serverSession.revision !== server.revision) {
    if (!sameWorkoutEdits(local.draft, local.serverSession)) return await setConflict(account.id, true, server) ?? local;
    return await refreshRecovery(account.id, account.displayName, server, preferences) ?? local;
  }
  if (sameWorkoutEdits(local.draft, server)) {
    return await refreshRecovery(account.id, account.displayName, server, preferences) ?? local;
  }
  if (!operationWasSent && sameWorkoutEdits(local.serverSession, server)) {
    // A draft that differs from the server with nothing queued can never be sent; it is a copy an
    // earlier reopen left behind, so the server's copy replaces it.
    if (!hasPending && !local.conflict) return await refreshRecovery(account.id, account.displayName, server, preferences) ?? local;
    return await setConflict(account.id, false, server) ?? local;
  }
  return local;
}
