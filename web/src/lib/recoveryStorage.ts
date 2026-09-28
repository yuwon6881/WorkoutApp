import type { WorkoutRecoveryRecord } from './workoutRecovery';
import { hasNativeWorkoutStore } from './platform';

export interface RecoveryStorage {
  get(accountId: string): Promise<WorkoutRecoveryRecord | null>;
  put(record: WorkoutRecoveryRecord): Promise<void>;
  delete(accountId: string): Promise<void>;
  getLastAccountId(): Promise<string | null>;
  setLastAccountId(accountId: string | null): Promise<void>;
  claimRestAlert(sessionId: string, generation: string): Promise<boolean>;
}

const DB_NAME = 'workout-recovery';
const DB_VERSION = 1;
const STORE_NAME = 'active-sessions';
const META_STORE = 'metadata';
const LAST_ACCOUNT_KEY = 'last-account';
const MIGRATION_KEY = 'workout_native_storage_migrated_v1';

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('This environment does not provide local workout storage.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'accountId' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local workout storage.'));
    request.onblocked = () => reject(new Error('Local workout storage is busy in another tab.'));
  }).catch(error => {
    database = null;
    throw error;
  });
  return database;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save this workout on the device.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local workout save was interrupted.'));
  });
}

function validateRecord(value: unknown, accountId: string): WorkoutRecoveryRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as WorkoutRecoveryRecord;
  if (
    record.schemaVersion !== 1 ||
    record.accountId !== accountId ||
    !record.sessionId ||
    record.draft?.id !== record.sessionId ||
    record.serverSession?.id !== record.sessionId ||
    !Array.isArray(record.operations)
  ) return null;
  return record;
}

const claimedAlertGenerations = new Set<string>();

export class IndexedDbRecoveryStorage implements RecoveryStorage {
  async get(accountId: string): Promise<WorkoutRecoveryRecord | null> {
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

  async put(record: WorkoutRecoveryRecord): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.objectStore(META_STORE).put(record.accountId, LAST_ACCOUNT_KEY);
    await transactionDone(tx);
  }

  async delete(accountId: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(accountId);
    await transactionDone(tx);
  }

  async getLastAccountId(): Promise<string | null> {
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

  async setLastAccountId(accountId: string | null): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    if (accountId) store.put(accountId, LAST_ACCOUNT_KEY);
    else store.delete(LAST_ACCOUNT_KEY);
    await transactionDone(tx);
  }

  async claimRestAlert(_sessionId: string, generation: string): Promise<boolean> {
    if (!generation || claimedAlertGenerations.has(generation)) return false;
    claimedAlertGenerations.add(generation);
    return true;
  }
}

export class NativeRecoveryStorage implements RecoveryStorage {
  private async getBridge() {
    return import('./nativeBridge');
  }

  async get(accountId: string): Promise<WorkoutRecoveryRecord | null> {
    await migrateIndexedDbToNativeIfNeeded(this);
    const bridge = await this.getBridge();
    const json = await bridge.nativeGetRecovery(accountId);
    if (!json) return null;
    try {
      const parsed = JSON.parse(json);
      return validateRecord(parsed, accountId);
    } catch {
      return null;
    }
  }

  async put(record: WorkoutRecoveryRecord): Promise<void> {
    const bridge = await this.getBridge();
    const recordJson = JSON.stringify(record);
    await bridge.nativeSaveRecovery(record.accountId, record.sessionId, recordJson);
  }

  async delete(accountId: string): Promise<void> {
    const bridge = await this.getBridge();
    await bridge.nativeDeleteRecovery(accountId);
  }

  async getLastAccountId(): Promise<string | null> {
    await migrateIndexedDbToNativeIfNeeded(this);
    const bridge = await this.getBridge();
    return bridge.nativeGetLastAccountId();
  }

  async setLastAccountId(accountId: string | null): Promise<void> {
    const bridge = await this.getBridge();
    await bridge.nativeSetLastAccountId(accountId);
  }

  async claimRestAlert(sessionId: string, generation: string): Promise<boolean> {
    const bridge = await this.getBridge();
    return bridge.nativeClaimRestAlert(sessionId, generation);
  }
}

let idbStorageInstance: IndexedDbRecoveryStorage | null = null;
let nativeStorageInstance: NativeRecoveryStorage | null = null;

export function getRecoveryStorage(): RecoveryStorage {
  if (hasNativeWorkoutStore()) {
    if (!nativeStorageInstance) nativeStorageInstance = new NativeRecoveryStorage();
    return nativeStorageInstance;
  }
  if (!idbStorageInstance) idbStorageInstance = new IndexedDbRecoveryStorage();
  return idbStorageInstance;
}

let migrationPromise: Promise<void> | null = null;

export async function migrateIndexedDbToNativeIfNeeded(nativeStorage: NativeRecoveryStorage): Promise<void> {
  if (!hasNativeWorkoutStore()) return;
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem(MIGRATION_KEY) === 'true') return;

  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    try {
      const idb = new IndexedDbRecoveryStorage();
      const lastAccount = await idb.getLastAccountId().catch(() => null);
      if (lastAccount) {
        const existingNative = await (await import('./nativeBridge')).nativeGetRecovery(lastAccount).catch(() => null);
        if (!existingNative) {
          const record = await idb.get(lastAccount).catch(() => null);
          if (record) {
            await nativeStorage.put(record);
            // Read the raw record back: nativeStorage.get() would wait on this very migration.
            const stored = await (await import('./nativeBridge')).nativeGetRecovery(lastAccount);
            const verified = stored ? validateRecord(JSON.parse(stored), lastAccount) : null;
            if (verified && verified.sessionId === record.sessionId) {
              await idb.delete(lastAccount).catch(() => undefined);
            }
          }
        }
        await nativeStorage.setLastAccountId(lastAccount);
      }
      localStorage.setItem(MIGRATION_KEY, 'true');
    } catch {
      // Best-effort migration; failsafe fallback continues
    } finally {
      migrationPromise = null;
    }
  })();
  return migrationPromise;
}
