import type { SessionRest } from '../types';
import { commitNativeRestImport, readNativeRestActions, type NativeRestAction } from './platform';
import { getRecovery, writeRecoveryMutation, type WorkoutRecoveryRecord } from './workoutRecovery';
export { recoveredRestState as committedRestState } from './recoveredRestState';

/** Project from durable recovery, never from the notification snapshot which already includes taps. */
export function projectNativeRestActions(baseline: WorkoutRecoveryRecord, actions: NativeRestAction[]) {
  if (baseline.conflict) throw new Error('Review this workout before recovering notification changes. They remain on this device.');
  const record = structuredClone(baseline);
  if (record.rest === undefined) record.rest = record.draft.rest ?? record.serverSession.rest;
  const importedIds: string[] = [];
  const supersededIds: string[] = [];
  const knownIds = new Set(record.operations.map(operation => operation.id));
  for (const action of actions) {
    if (action.accountId !== record.accountId || action.sessionId !== record.sessionId) continue;
    if (!action.id || !action.resultingGeneration || !Number.isFinite(action.atMs))
      throw new Error('Notification changes could not be recovered. They remain on this device.');
    if (importedIds.includes(action.id)) continue;
    importedIds.push(action.id);
    if (knownIds.has(action.id)) continue;
    if (record.rest === undefined && record.draft.active && !record.draft.finishedAt)
      throw new Error('The saved rest is not available yet. Notification changes remain on this device; reopen the workout to retry.');
    if (!record.draft.active || record.draft.finishedAt || record.serverSession.active === false || record.serverSession.finishedAt || record.operations.some(operation => operation.type === 'finish') ||
      !record.rest || record.rest.generation !== action.generation) {
      supersededIds.push(action.id);
      continue;
    }
    const occurredAt = new Date(action.atMs).toISOString();
    record.operations.push({ id: action.id, type: 'rest', revision: null, createdAt: occurredAt,
      rest: { revision: record.serverSession.revision, action: action.kind, seconds: action.seconds,
        generation: action.resultingGeneration, occurredAt } });
    knownIds.add(action.id);
    record.rest = transitionRest(record.rest, action);
    record.updatedAt = new Date().toISOString();
  }
  return { record, importedIds, supersededIds };
}

function transitionRest(rest: SessionRest, action: NativeRestAction): SessionRest {
  const generation = action.resultingGeneration!;
  const idle: SessionRest = { generation, status: 'idle', deadlineUtc: null, pausedRemainingMs: null,
    durationMs: null, originDeviceId: null };
  if (action.kind === 'skip') return idle;
  const delta = action.seconds * 1000 * (action.kind === 'extend' ? 1 : -1);
  const durationMs = (rest.durationMs ?? 0) + (delta > 0 ? delta : 0);
  if (rest.status === 'paused') {
    const pausedRemainingMs = (rest.pausedRemainingMs ?? 0) + delta;
    return pausedRemainingMs > 0 ? { ...rest, generation, durationMs, pausedRemainingMs } : idle;
  }
  const deadline = Date.parse(rest.deadlineUtc ?? '');
  if (!Number.isFinite(deadline)) throw new Error('The saved rest needs review. Notification changes remain on this device.');
  const next = (delta > 0 ? Math.max(action.atMs, deadline) : deadline) + delta;
  return next > action.atMs ? { ...rest, generation, durationMs, deadlineUtc: new Date(next).toISOString() } : idle;
}

export async function importNativeRestActions(accountId: string, sessionId: string): Promise<WorkoutRecoveryRecord | null> {
  return writeRecoveryMutation(accountId, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const actions = await readNativeRestActions();
      if (!actions.some(action => action.accountId === accountId && action.sessionId === sessionId)) return null;
      const baseline = await getRecovery(accountId);
      if (!baseline || baseline.sessionId !== sessionId)
        throw new Error('The workout is not available yet. Notification changes remain on this device; reopen the workout to retry.');
      const { record, importedIds } = projectNativeRestActions(baseline, actions);
      if (await commitNativeRestImport({ accountId, sessionId, expectedJson: JSON.stringify(baseline),
        recordJson: JSON.stringify(record), importedIds })) return record;
    }
    throw new Error('The workout changed while recovering notification actions. Reopen it to retry; the actions remain on this device.');
  });
}
