import type { LoggedSet, Preferences, Session } from '../types';
import { reconcileSetPatchOperation, sameWorkoutEdits, sameWorkoutNonSetEdits } from './workoutRecoveryComparison';

export { reconcileSetPatchOperation, sameWorkoutEdits };
export { defaultDevicePreferences, loadDevicePreferences, saveDevicePreferences } from './workoutDevicePreferences';
export type { DevicePreferences } from './workoutDevicePreferences';

const DB_NAME = 'workout-recovery';
const DB_VERSION = 1;
const STORE_NAME = 'active-sessions';
const META_STORE = 'metadata';
const LAST_ACCOUNT_KEY = 'last-account';

export type WorkoutOperation =
  | { id: string; type: 'save'; draft: Session; revision: number | null; createdAt: string }
  | { id: string; type: 'setPatch'; setId: string; patch: SetPatch; revision: number | null; createdAt: string }
  | { id: string; type: 'pause' | 'resume'; occurredAt: string; revision: number | null; createdAt: string }
  | { id: string; type: 'finish'; finishedAt: string; retainExerciseSwaps: boolean; revision: number | null; createdAt: string };

export type SetPatch = Partial<Pick<LoggedSet, 'weightKg' | 'reps' | 'rpe' | 'done' | 'warmup' | 'resistanceMode'>>;

export type WorkoutRecoveryRecord = {
  schemaVersion: 1;
  accountId: string;
  displayName: string;
  sessionId: string;
  draft: Session;
  serverSession: Session;
  preferences: Preferences;
  activeIndex: number;
  viewMode: 'focus' | 'all';
  operations: WorkoutOperation[];
  conflict: boolean;
  updatedAt: string;
};

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('This browser does not provide local workout storage.')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'accountId' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local workout storage.'));
    request.onblocked = () => reject(new Error('Local workout storage is busy in another tab.'));
  }).catch(error => { database = null; throw error; });
  return database!;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save this workout on the device.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local workout save was interrupted.'));
  });
}

export async function getRecovery(accountId: string): Promise<WorkoutRecoveryRecord | null> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const done = transactionDone(tx);
  void done.catch(() => undefined);
  const result = await new Promise<WorkoutRecoveryRecord | null>((resolve, reject) => {
    const request = tx.objectStore(STORE_NAME).get(accountId);
    request.onsuccess = () => resolve(validateRecord(request.result, accountId));
    request.onerror = () => reject(request.error ?? new Error('Could not read the saved workout.'));
  });
  await done;
  return result;
}

export async function getLastRecovery(): Promise<WorkoutRecoveryRecord | null> {
  const accountId = await getLastAccountId();
  return accountId ? getRecovery(accountId) : null;
}

export async function getLastAccountId(): Promise<string | null> {
  const db = await openDatabase();
  const tx = db.transaction(META_STORE, 'readonly');
  const done = transactionDone(tx);
  void done.catch(() => undefined);
  const accountId = await new Promise<string | null>((resolve, reject) => {
    const request = tx.objectStore(META_STORE).get(LAST_ACCOUNT_KEY);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error('Could not read the saved workout account.'));
  });
  await done;
  return accountId;
}

export async function setLastAccount(accountId: string | null): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(META_STORE, 'readwrite');
  const store = tx.objectStore(META_STORE);
  if (accountId) store.put(accountId, LAST_ACCOUNT_KEY);
  else store.delete(LAST_ACCOUNT_KEY);
  await transactionDone(tx);
}

export async function startRecovery(record: Omit<WorkoutRecoveryRecord, 'schemaVersion' | 'operations' | 'conflict' | 'updatedAt'>): Promise<void> {
  await serializeWrite(record.accountId, async () => {
    const existing = await getRecovery(record.accountId);
    if (existing && existing.sessionId !== record.sessionId && hasUnresolvedRecovery(existing))
      throw new Error('An earlier workout still has changes that need review. Resolve it before starting another workout.');
    const db = await openDatabase();
    const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
    const complete = transactionDone(tx);
    tx.objectStore(STORE_NAME).put({ ...record, schemaVersion: 1, operations: [], conflict: false, updatedAt: new Date().toISOString() });
    tx.objectStore(META_STORE).put(record.accountId, LAST_ACCOUNT_KEY);
    await complete;
    if (navigator.storage?.persist) { try { await navigator.storage.persist(); } catch { /* best effort */ } }
  });
}

export async function refreshRecovery(accountId: string, displayName: string, serverSession: Session, preferences: Preferences): Promise<WorkoutRecoveryRecord | null> {
  return serializeWrite(accountId, async () => {
    const record = await getRecovery(accountId);
    if (!record || record.sessionId !== serverSession.id) return null;
    record.displayName = displayName;
    record.serverSession = serverSession;
    record.preferences = preferences;
    if (sameWorkoutEdits(record.draft, serverSession)) {
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

export async function enqueueSave(accountId: string, draft: Session, navigation: { activeIndex: number; viewMode: 'focus' | 'all' }): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, draft.id);
    if (record.conflict) throw new Error('This workout changed on the server. Review both versions before saving.');
    record.draft = draft;
    record.activeIndex = navigation.activeIndex;
    record.viewMode = navigation.viewMode;
    record.updatedAt = new Date().toISOString();
    record.conflict = false;
    const tail = record.operations.at(-1);
    if (tail?.type === 'save' && tail.revision === null) tail.draft = draft;
    else record.operations.push({ id: crypto.randomUUID(), type: 'save', draft, revision: null, createdAt: record.updatedAt });
    await putRecord(record);
    return record;
  });
}

export async function enqueueSetEdits(accountId: string, draft: Session, navigation: { activeIndex: number; viewMode: 'focus' | 'all' }): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, draft.id);
    if (record.conflict) throw new Error('This workout changed on the server. Review both versions before saving.');
    record.draft = draft;
    record.activeIndex = navigation.activeIndex;
    record.viewMode = navigation.viewMode;
    record.updatedAt = new Date().toISOString();
    record.conflict = false;

    // Set-only edits use PATCH, so a delayed client cannot replace unrelated server state. If a
    // note or exercise edit is also waiting in a draft, the full-save operation carries it too.
    const previousFullSave = [...record.operations].reverse().find((operation): operation is Extract<WorkoutOperation, { type: 'save' }> => operation.type === 'save');
    if (!sameWorkoutNonSetEdits(record.serverSession, draft) ||
      (previousFullSave && !sameWorkoutNonSetEdits(previousFullSave.draft, draft))) {
      const tail = record.operations.at(-1);
      if (tail?.type === 'save' && tail.revision === null) tail.draft = draft;
      else record.operations.push({ id: crypto.randomUUID(), type: 'save', draft, revision: null, createdAt: record.updatedAt });
      await putRecord(record);
      return record;
    }

    const baselineSets = new Map(record.serverSession.exercises.flatMap(exercise => exercise.sets.map(set => [set.id, set] as const)));
    for (const exercise of draft.exercises) {
      for (const set of exercise.sets) {
        const baseline = baselineSets.get(set.id);
        if (!baseline) continue;
        const patch: SetPatch = {
          weightKg: set.weightKg, reps: set.reps, rpe: set.rpe, done: set.done,
          warmup: set.warmup, resistanceMode: set.resistanceMode
        };
        const baselinePatch: SetPatch = {
          weightKg: baseline.weightKg, reps: baseline.reps, rpe: baseline.rpe, done: baseline.done,
          warmup: baseline.warmup, resistanceMode: baseline.resistanceMode
        };
        reconcileSetPatchOperation(record.operations, set.id, patch, baselinePatch, record.updatedAt);
      }
    }
    await putRecord(record);
    return record;
  });
}

export async function persistDraftOnly(accountId: string, draft: Session, navigation: { activeIndex: number; viewMode: 'focus' | 'all' }): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, draft.id);
    record.draft = draft;
    record.activeIndex = navigation.activeIndex;
    record.viewMode = navigation.viewMode;
    record.updatedAt = new Date().toISOString();
    await putRecord(record);
    return record;
  });
}

export async function saveNavigation(accountId: string, sessionId: string, navigation: { activeIndex: number; viewMode: 'focus' | 'all' }): Promise<void> {
  await serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, sessionId);
    record.activeIndex = navigation.activeIndex;
    record.viewMode = navigation.viewMode;
    record.updatedAt = new Date().toISOString();
    await putRecord(record);
  });
}

export async function enqueueTiming(accountId: string, type: 'pause' | 'resume', occurredAt: string, draft: Session): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, draft.id);
    record.draft = draft;
    record.updatedAt = new Date().toISOString();
    record.operations.push({ id: crypto.randomUUID(), type, occurredAt, revision: null, createdAt: record.updatedAt });
    await putRecord(record);
    return record;
  });
}

export async function enqueueFinish(accountId: string, finishedAt: string, retainExerciseSwaps: boolean, draft: Session): Promise<WorkoutRecoveryRecord> {
  return serializeWrite(accountId, async () => {
    const record = await requireRecovery(accountId, draft.id);
    record.draft = draft;
    record.updatedAt = new Date().toISOString();
    record.operations.push({ id: crypto.randomUUID(), type: 'finish', finishedAt, retainExerciseSwaps, revision: null, createdAt: record.updatedAt });
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
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(accountId);
    await transactionDone(tx);
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
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(record);
  await transactionDone(tx);
}

function validateRecord(value: unknown, accountId: string): WorkoutRecoveryRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as WorkoutRecoveryRecord;
  if (record.schemaVersion !== 1 || record.accountId !== accountId || !record.sessionId || record.draft?.id !== record.sessionId || record.serverSession?.id !== record.sessionId || !Array.isArray(record.operations)) return null;
  return record;
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
