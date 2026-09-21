import { ApiError, api } from './api';
import {
  acknowledgeOperation, bindOperation, clearRecovery, getRecovery, sameWorkoutEdits,
  setConflict, withRecoveryLock
} from './workoutRecovery';
import type { WorkoutRecoveryRecord } from './workoutRecovery';
import type { Session } from '../types';

export type RecoveryDrainHandlers = {
  onSaved: (session: Session, recovery: WorkoutRecoveryRecord | null) => void;
  onFinished: (session: Session) => void | Promise<void>;
  onConflict: (recovery: WorkoutRecoveryRecord, remote: Session) => void;
};

/// Last-resort path for an online workout when local IndexedDB is unavailable. These requests
/// remain idempotent within the open page, but cannot recover after the page itself is lost.
export function applyOnlineTiming(
  sessionId: string, kind: 'pause' | 'resume', revision: number, mutationId: string, occurredAt: string
): Promise<Session> {
  const input = { revision, mutationId, occurredAt };
  return kind === 'pause' ? api.pauseWorkout(sessionId, input) : api.resumeWorkout(sessionId, input);
}

export async function finishOnlineWithoutRecovery(
  draft: Session, revision: number, saveMutationId: string, finishMutationId: string, finishedAt: string, retainExerciseSwaps: boolean
): Promise<Session> {
  const saved = await api.saveWorkout(draft.id, sessionPayload(draft, revision, saveMutationId));
  return api.finishWorkout(draft.id, {
    revision: saved.revision, mutationId: finishMutationId, finishedAt, retainExerciseSwaps
  });
}

export async function drainWorkoutOutbox(
  accountId: string,
  sessionId: string,
  getServerSession: () => Session,
  handlers: RecoveryDrainHandlers
): Promise<void> {
  await withRecoveryLock(accountId, sessionId, async () => {
    while (true) {
      let recovery = await getRecovery(accountId);
      if (!recovery || recovery.sessionId !== sessionId || recovery.operations.length === 0) return;
      if (recovery.conflict) throw new ApiError('This workout changed on another device. Review both versions before saving.', 409);
      let operation = recovery.operations[0];
      const currentServer = getServerSession();

      if (operation.revision === null) {
        if (!sameWorkoutEdits(currentServer, recovery.serverSession)) {
          recovery = await setConflict(accountId, true, currentServer) ?? recovery;
          handlers.onConflict(recovery, currentServer);
          throw new ApiError('This workout changed on another device. Your local changes are safe; review both versions.', 409);
        }
        if (currentServer.revision !== recovery.serverSession.revision)
          recovery = await setConflict(accountId, false, currentServer) ?? recovery;
        recovery = await bindOperation(accountId, operation.id, currentServer.revision);
        operation = recovery.operations[0];
      }

      let saved: Session;
      try {
        switch (operation.type) {
          case 'save':
            saved = await api.saveWorkout(sessionId, sessionPayload(operation.draft, operation.revision!, operation.id));
            break;
          case 'setPatch':
            saved = await api.patchWorkoutSet(sessionId, operation.setId, {
              ...operation.patch, revision: operation.revision!, mutationId: operation.id
            });
            break;
          case 'pause':
            saved = await api.pauseWorkout(sessionId, { revision: operation.revision!, mutationId: operation.id, occurredAt: operation.occurredAt });
            break;
          case 'resume':
            saved = await api.resumeWorkout(sessionId, { revision: operation.revision!, mutationId: operation.id, occurredAt: operation.occurredAt });
            break;
          case 'finish':
            saved = await api.finishWorkout(sessionId, {
              revision: operation.revision!, mutationId: operation.id,
              finishedAt: operation.finishedAt, retainExerciseSwaps: operation.retainExerciseSwaps
            });
            break;
        }
      } catch (failure) {
        if (failure instanceof ApiError && failure.conflict) {
          const remote = await api.getWorkout(sessionId).catch(() => null);
          if (remote) {
            recovery = await setConflict(accountId, true, remote) ?? recovery;
            handlers.onConflict(recovery, remote);
          }
        }
        throw failure;
      }

      const expectedRevision = operation.revision! + 1;
      if (operation.type !== 'finish' && saved.revision > expectedRevision &&
        !sameWorkoutEdits(saved, operation.type === 'save' ? operation.draft : currentServer)) {
        recovery = await setConflict(accountId, true, saved) ?? recovery;
        handlers.onConflict(recovery, saved);
        throw new ApiError('Another device changed this workout while it was syncing. Your local changes are safe for review.', 409);
      }

      recovery = await acknowledgeOperation(accountId, operation.id, saved) ?? recovery;
      if (operation.type === 'finish') {
        await clearRecovery(accountId);
        await handlers.onFinished(saved);
        return;
      }
      handlers.onSaved(saved, recovery);
      if (recovery.operations.length === 0) return;
    }
  });
}

export function sessionPayload(session: Session, revision: number, idempotencyId: string) {
  return {
    note: session.note,
    revision,
    idempotencyId,
    exercises: session.exercises.map(exercise => ({
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      nameSnapshot: exercise.name,
      note: exercise.note,
      prescription: exercise.prescription,
      sequenceGroup: exercise.sequenceGroup,
      substitutions: exercise.substitutions,
      loadModel: exercise.loadModel,
      sourceTemplateExerciseId: exercise.sourceTemplateExerciseId,
      sourceSlotKey: exercise.sourceSlotKey,
      sourcePhaseId: exercise.sourcePhaseId,
      sourcePage: exercise.sourcePage,
      sets: exercise.sets.map(set => ({
        id: set.id,
        weightKg: set.weightKg,
        reps: set.reps,
        rpe: set.rpe,
        done: set.done,
        warmup: set.warmup,
        resistanceMode: set.resistanceMode
      }))
    }))
  };
}
