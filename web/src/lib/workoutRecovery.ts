import type { LoggedSet, Preferences, RestMutationInput, Session, SessionRest } from '../types';
import { reconcileSetPatchOperation, sameWorkoutEdits, sameWorkoutNonSetEdits } from './workoutRecoveryComparison';
import { getRecoveryStorage } from './recoveryStorage';
import { discardStopwatch, type RunningStopwatch } from './setStopwatch';

export { reconcileSetPatchOperation, sameWorkoutEdits };
export { defaultDevicePreferences, loadDevicePreferences, saveDevicePreferences } from './workoutDevicePreferences';
export type { DevicePreferences } from './workoutDevicePreferences';

export type WorkoutOperation =
  | { id: string; type: 'save'; draft: Session; revision: number | null; createdAt: string }
  | { id: string; type: 'setPatch'; setId: string; patch: SetPatch; rest?: RestMutationInput | null; revision: number | null; createdAt: string }
  | { id: string; type: 'rest'; rest: RestMutationInput; revision: number | null; createdAt: string }
  | { id: string; type: 'pause' | 'resume'; occurredAt: string; revision: number | null; createdAt: string }
  | { id: string; type: 'finish'; finishedAt: string; retainExerciseSwaps: boolean; planUpdate?: import('./finishPlanContract').FinishPlanUpdateInput; revision: number | null; createdAt: string };

export type SetPatch = Partial<Pick<LoggedSet, 'weightKg' | 'reps' | 'durationSeconds' | 'rpe' | 'rir' | 'done' | 'warmup' | 'resistanceMode'>>;

export type WorkoutRecoveryRecord = {
  schemaVersion: 1;
  accountId: string;
  displayName: string;
  sessionId: string;
  draft: Session;
  serverSession: Session;
  preferences: Preferences;
  activeIndex: number;
  operations: WorkoutOperation[];
  conflict: boolean;
  updatedAt: string;
  rest?: SessionRest | null;
  /** Timed sets still counting, so a hold survives the app closing or crashing mid-set. */
  stopwatches?: Record<string, RunningStopwatch>;
};

export async function getRecovery(accountId: string): Promise<WorkoutRecoveryRecord | null> {
  return getRecoveryStorage().get(accountId);
}

export async function getLastRecovery(): Promise<WorkoutRecoveryRecord | null> {
  const accountId = await getLastAccountId();
  return accountId ? getRecovery(accountId) : null;
}

export async function getLastAccountId(): Promise<string | null> {
  return getRecoveryStorage().getLastAccountId();
}

export async function setLastAccount(accountId: string | null): Promise<void> {
  return getRecoveryStorage().setLastAccountId(accountId);
}

/// Returns the stored record so a caller can show it without reading it straight back.
export async function startRecovery(record: Omit<WorkoutRecoveryRecord, 'schemaVersion' | 'operations' | 'conflict' | 'updatedAt'>): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(record.accountId, async () => {
    const existing = await getRecovery(record.accountId);
    if (existing && existing.sessionId !== record.sessionId && hasUnresolvedRecovery(existing))
      throw new Error('An earlier workout still has changes that need review. Resolve it before starting another workout.');
    const fullRecord: WorkoutRecoveryRecord = {
      ...record,
      schemaVersion: 1,
      operations: [],
      conflict: false,
      updatedAt: new Date().toISOString(),
      rest: record.rest ?? null
    };
    await putRecord(fullRecord);
    await setLastAccount(record.accountId);
    // Durable storage is advisory and the browser may take its time to answer; the record is
    // already written, so starting a workout does not wait for it.
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) void navigator.storage.persist().catch(() => undefined);
    // A copy, as a read would give: draft and serverSession must not share one object.
    return structuredClone(fullRecord);
  });
}

export async function refreshRecovery(accountId: string, displayName: string, serverSession: Session, preferences: Preferences): Promise<WorkoutRecoveryRecord | null> {
  return serializeWrite(accountId, async () => {
    const record = await getRecovery(accountId);
    if (!record || record.sessionId !== serverSession.id) return null;
    record.displayName = displayName;
    record.serverSession = serverSession;
    record.preferences = preferences;
    if (serverSession.rest !== undefined) record.rest = serverSession.rest;
    // With nothing queued, this device holds no edit the server lacks, so the server's copy is the
    // workout, including sets another device logged since this one last synced.
    if (record.operations.length === 0 || sameWorkoutEdits(record.draft, serverSession)) {
      record.draft = serverSession;
      record.operations = record.operations.filter(operation => operation.type !== 'save');
    }
    record.conflict = false;
    record.updatedAt = new Date().toISOString();
    await putRecord(record);
    return record;
  });
}

export async function reconcileDirectTiming(accountId: string, serverSession: Session, preferences: Preferences): Promise<WorkoutRecoveryRecord | null> {
  return serializeWrite(accountId, async () => {
    const record = await getRecovery(accountId);
    if (!record || record.sessionId !== serverSession.id) return null;
    if (record.operations.length > 0) {
      record.conflict = true;
      record.serverSession = serverSession;
      await putRecord(record);
      return record;
    }
    record.serverSession = serverSession;
    record.preferences = preferences;
    if (serverSession.rest !== undefined) record.rest = serverSession.rest;
    record.draft = {
      ...record.draft,
      revision: serverSession.revision,
      active: serverSession.active,
      finishedAt: serverSession.finishedAt,
      pausedAt: serverSession.pausedAt,
      pausedSeconds: serverSession.pausedSeconds
    };
    record.updatedAt = new Date().toISOString();
    await putRecord(record);
    return record;
  });
}

export async function enqueueSave(accountId: string, draft: Session, navigation: { activeIndex: number }): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, draft.id);
    if (record.conflict) throw new Error('This workout changed on the server. Review both versions before saving.');
    record.draft = draft;
    record.activeIndex = navigation.activeIndex;
    record.updatedAt = new Date().toISOString();
    record.conflict = false;
    const tail = record.operations.at(-1);
    if (tail?.type === 'save' && tail.revision === null) tail.draft = draft;
    else record.operations.push({ id: crypto.randomUUID(), type: 'save', draft, revision: null, createdAt: record.updatedAt });
    await putRecord(record);
    return record;
  });
}

export async function enqueueSetEdits(
  accountId: string,
  draft: Session,
  navigation: { activeIndex: number },
  restMutation?: RestMutationInput | null,
  restState?: SessionRest | null
): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, draft.id);
    if (record.conflict) throw new Error('This workout changed on the server. Review both versions before saving.');
    record.draft = draft;
    record.activeIndex = navigation.activeIndex;
    record.updatedAt = new Date().toISOString();
    record.conflict = false;
    if (restState !== undefined) record.rest = restState;

    // Set-only edits use PATCH, so a delayed client cannot replace unrelated server state. If a
    // note or exercise edit is also waiting in a draft, the full-save operation carries it too.
    const previousFullSave = [...record.operations].reverse().find((operation): operation is Extract<WorkoutOperation, { type: 'save' }> => operation.type === 'save');
    if (!sameWorkoutNonSetEdits(record.serverSession, draft) ||
      (previousFullSave && !sameWorkoutNonSetEdits(previousFullSave.draft, draft))) {
      const tail = record.operations.at(-1);
      if (tail?.type === 'save' && tail.revision === null) tail.draft = draft;
      else record.operations.push({ id: crypto.randomUUID(), type: 'save', draft, revision: null, createdAt: record.updatedAt });
      if (restMutation) {
        record.operations.push({ id: crypto.randomUUID(), type: 'rest', rest: restMutation, revision: null, createdAt: record.updatedAt });
      }
      await putRecord(record);
      return record;
    }

    const baselineSets = new Map(record.serverSession.exercises.flatMap(exercise => exercise.sets.map(set => [set.id, set] as const)));
    for (const exercise of draft.exercises) {
      for (const set of exercise.sets) {
        const baseline = baselineSets.get(set.id);
        if (!baseline) continue;
        const patch: SetPatch = {
          weightKg: set.weightKg, reps: set.reps, durationSeconds: set.durationSeconds ?? null, rpe: set.rpe, rir: set.rir ?? null, done: set.done,
          warmup: set.warmup, resistanceMode: set.resistanceMode
        };
        const baselinePatch: SetPatch = {
          weightKg: baseline.weightKg, reps: baseline.reps, durationSeconds: baseline.durationSeconds ?? null, rpe: baseline.rpe, rir: baseline.rir ?? null, done: baseline.done,
          warmup: baseline.warmup, resistanceMode: baseline.resistanceMode
        };
        reconcileSetPatchOperation(record.operations, set.id, patch, baselinePatch, record.updatedAt);
      }
    }
    if (restMutation) {
      const lastOp = record.operations.at(-1);
      if (lastOp && lastOp.type === 'setPatch' && lastOp.revision === null) {
        lastOp.rest = restMutation;
      } else {
        record.operations.push({ id: crypto.randomUUID(), type: 'rest', rest: restMutation, revision: null, createdAt: record.updatedAt });
      }
    }
    await putRecord(record);
    return record;
  });
}

export async function enqueueRest(
  accountId: string,
  sessionId: string,
  restMutation: RestMutationInput,
  draft?: Session,
  restState?: SessionRest | null
): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, sessionId);
    if (record.conflict) throw new Error('This workout changed on the server. Review both versions before saving.');
    if (draft) record.draft = draft;
    if (restState !== undefined) record.rest = restState;
    record.updatedAt = new Date().toISOString();
    record.conflict = false;
    record.operations.push({
      id: crypto.randomUUID(),
      type: 'rest',
      rest: restMutation,
      revision: null,
      createdAt: record.updatedAt
    });
    await putRecord(record);
    return record;
  });
}

export async function persistDraftOnly(accountId: string, draft: Session, navigation: { activeIndex: number }): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, draft.id);
    record.draft = draft;
    record.activeIndex = navigation.activeIndex;
    record.updatedAt = new Date().toISOString();
    await putRecord(record);
    return record;
  });
}

export async function saveNavigation(accountId: string, sessionId: string, navigation: { activeIndex: number }): Promise<void> {
  await serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, sessionId);
    record.activeIndex = navigation.activeIndex;
    record.updatedAt = new Date().toISOString();
    await putRecord(record);
  });
}

export async function enqueueTiming(accountId: string, type: 'pause' | 'resume', occurredAt: string, draft: Session): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, draft.id);
    record.draft = draft;
    const now = Date.parse(occurredAt);
    record.stopwatches = Object.fromEntries(Object.entries(record.stopwatches ?? {}).map(([id, timer]) => {
      if (type === 'pause' && timer.pausedAtMs === undefined) return [id, { ...timer, pausedAtMs: now }];
      if (type === 'resume' && timer.pausedAtMs !== undefined) {
        const next = { ...timer, startedAtMs: timer.startedAtMs + Math.max(0, now - timer.pausedAtMs) };
        delete next.pausedAtMs;
        return [id, next];
      }
      return [id, timer];
    }));
    record.updatedAt = new Date().toISOString();
    record.operations.push({ id: crypto.randomUUID(), type, occurredAt, revision: null, createdAt: record.updatedAt });
    await putRecord(record);
    return record;
  });
}

export async function enqueueFinish(accountId: string, finishedAt: string, retainExerciseSwaps: boolean, draft: Session, planUpdate?: import('./finishPlanContract').FinishPlanUpdateInput): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, draft.id);
    record.draft = draft;
    record.stopwatches = {};
    record.updatedAt = new Date().toISOString();
    record.operations.push({ id: crypto.randomUUID(), type: 'finish', finishedAt, retainExerciseSwaps, ...(planUpdate ? { planUpdate } : {}), revision: null, createdAt: record.updatedAt });
    await putRecord(record);
    return record;
  });
}

export async function bindOperation(accountId: string, operationId: string, revision: number): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId);
    const operation = record.operations.find(item => item.id === operationId);
    if (!operation) throw new Error('The pending workout change is no longer available.');
    if (operation.revision === null) operation.revision = revision;
    await putRecord(record);
    return record;
  });
}

export async function acknowledgeOperation(accountId: string, operationId: string, saved: Session): Promise<WorkoutRecoveryRecord | null> {
  return serializeWrite(accountId, async () => {
    const record = await getRecovery(accountId);
    if (!record || record.sessionId !== saved.id) return null;
    record.operations = record.operations.filter(item => item.id !== operationId);
    record.serverSession = saved;
    record.conflict = false;
    if (record.operations.length === 0 && sameWorkoutEdits(record.draft, saved)) record.draft = saved;
    record.updatedAt = new Date().toISOString();
    await putRecord(record);
    return record;
  });
}

export async function setConflict(accountId: string, conflict: boolean, serverSession?: Session): Promise<WorkoutRecoveryRecord | null> {
  return serializeWrite(accountId, async () => {
    const record = await getRecovery(accountId);
    if (!record) return null;
    if (serverSession) record.serverSession = serverSession;
    record.conflict = conflict;
    await putRecord(record);
    return record;
  });
}

export async function clearRecovery(accountId: string): Promise<void> {
  await serializeWrite(accountId, async () => {
    const record = await getRecovery(accountId);
    await getRecoveryStorage().delete(accountId);
    for (const exercise of record?.draft.exercises ?? [])
      for (const set of exercise.sets) discardStopwatch(set.id);
  });
}

export async function useServerWorkout(accountId: string, serverSession: Session): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId);
    record.draft = serverSession;
    record.serverSession = serverSession;
    record.operations = [];
    record.conflict = false;
    record.updatedAt = new Date().toISOString();
    await putRecord(record);
    return record;
  });
}

export async function keepLocalWorkout(accountId: string, serverSession: Session): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId);
    if (hasPendingTimingOperations(record))
      throw new Error('Pause timing changed during this conflict and cannot be safely merged. Your on-device workout is preserved; use the server copy to continue.');
    record.serverSession = serverSession;
    const pendingFinish = record.operations.find((operation): operation is Extract<WorkoutOperation, { type: 'finish' }> => operation.type === 'finish');
    record.operations = [];
    record.conflict = false;
    record.draft = { ...record.draft, pausedAt: serverSession.pausedAt ?? null, pausedSeconds: serverSession.pausedSeconds ?? 0 };
    record.updatedAt = new Date().toISOString();
    if (!sameWorkoutEdits(record.draft, serverSession))
      record.operations.push({ id: crypto.randomUUID(), type: 'save', draft: record.draft, revision: null, createdAt: record.updatedAt });
    if (pendingFinish) record.operations.push({ ...pendingFinish, revision: null });
    await putRecord(record);
    return record;
  });
}

const localLocks = new Map<string, Promise<void>>();

export async function withRecoveryLock<T>(accountId: string, sessionId: string, action: () => Promise<T>): Promise<T> {
  const name = `workout-recovery:${accountId}:${sessionId}`;
  const locks = (navigator as Navigator & { locks?: { request<TValue>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<TValue>): Promise<TValue> } }).locks;
  if (locks) return locks.request(name, { mode: 'exclusive' }, action);
  const prior = localLocks.get(name) ?? Promise.resolve();
  let unlock!: () => void;
  const current = new Promise<void>(resolve => { unlock = resolve; });
  const next = prior.then(() => current);
  localLocks.set(name, next);
  await prior;
  try { return await action(); }
  finally { unlock(); if (localLocks.get(name) === next) localLocks.delete(name); }
}

async function requireRecovery(accountId: string, sessionId?: string): Promise<WorkoutRecoveryRecord> {
  const record = await getRecovery(accountId);
  if (!record || (sessionId && record.sessionId !== sessionId)) throw new Error('The active workout is not saved on this device yet.');
  return record;
}

async function putRecord(record: WorkoutRecoveryRecord): Promise<void> {
  await getRecoveryStorage().put(record);
}

function serializeWrite<T>(key: string, operation: () => Promise<T>): Promise<T> {
  return writeRecoveryMutation(key, operation);
}

export type RecoveryLockManager = {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>;
};

export function createRecoveryMutationSerializer(lockManager?: RecoveryLockManager) {
  const writes = new Map<string, Promise<void>>();
  return function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const runInThisTab = () => {
      const previous = writes.get(key) ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(operation);
      writes.set(key, current.then(() => undefined, () => undefined));
      return current;
    };
    // IndexedDB transactions are atomic, but the record mutations intentionally span a read
    // followed by a write transaction. Serialize those read/modify/write sections across tabs.
    return lockManager ? lockManager.request(`workout-recovery-write:${key}`, { mode: 'exclusive' }, runInThisTab) : runInThisTab();
  };
}

function getRecoveryLockManager(): RecoveryLockManager | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { locks?: RecoveryLockManager }).locks;
}

const writeRecoveryMutation = createRecoveryMutationSerializer(getRecoveryLockManager());

export function hasUnresolvedRecovery(record: WorkoutRecoveryRecord): boolean {
  return record.conflict || record.operations.length > 0 || !sameWorkoutEdits(record.draft, record.serverSession);
}

export function hasPendingTimingOperations(record: WorkoutRecoveryRecord): boolean {
  return record.operations.some(operation => operation.type === 'pause' || operation.type === 'resume');
}

export function isStorageFailure(failure: unknown): boolean {
  return failure instanceof Error && /device|storage|quota|indexeddb|transaction/i.test(failure.message);
}

/// Keeps the running timed-set stopwatches with the workout. Only this session's sets are kept.
export async function saveStopwatches(accountId: string, sessionId: string, stopwatches: Record<string, RunningStopwatch>): Promise<void> {
  await serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, sessionId);
    const setIds = new Set(record.draft.exercises.flatMap(exercise => exercise.sets.map(set => set.id)));
    const kept = Object.fromEntries(Object.entries(stopwatches).filter(([setId]) => setIds.has(setId)));
    if (JSON.stringify(kept) === JSON.stringify(record.stopwatches ?? {})) return;
    record.stopwatches = kept;
    await putRecord(record);
  });
}

/// Adopts a session the server just returned for a direct change (a swap or a restore). Those run
/// only after this device's queued edits were sent, so the server's copy is the whole workout; the
/// recovery copy takes it too, or a crash before the next edit would reopen the old exercise list.
export async function adoptServerSession(accountId: string, saved: Session): Promise<WorkoutRecoveryRecord | null> {
  return serializeWrite(accountId, async () => {
    const record = await getRecovery(accountId);
    if (!record || record.sessionId !== saved.id) return null;
    record.serverSession = saved;
    if (record.operations.length === 0) record.draft = saved;
    if (saved.rest !== undefined) record.rest = saved.rest;
    record.updatedAt = new Date().toISOString();
    await putRecord(record);
    return record;
  });
}
