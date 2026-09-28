import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutRecoveryRecord } from './workoutRecovery';
import type { Session } from '../types';

const storageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => { storageMap.set(key, String(val)); },
  removeItem: (key: string) => { storageMap.delete(key); },
  clear: () => { storageMap.clear(); }
};
(globalThis as unknown as { localStorage: typeof mockLocalStorage }).localStorage = mockLocalStorage;

const nativeMocks = vi.hoisted(() => ({
  nativeGetRecovery: vi.fn(),
  nativeSaveRecovery: vi.fn(),
  nativeDeleteRecovery: vi.fn(),
  nativeGetLastAccountId: vi.fn(),
  nativeSetLastAccountId: vi.fn(),
  nativeClaimRestAlert: vi.fn(),
  isNative: vi.fn(() => false)
}));

vi.mock('./platform', () => ({
  hasNativeWorkoutStore: nativeMocks.isNative
}));

vi.mock('./nativeBridge', () => ({
  nativeGetRecovery: nativeMocks.nativeGetRecovery,
  nativeSaveRecovery: nativeMocks.nativeSaveRecovery,
  nativeDeleteRecovery: nativeMocks.nativeDeleteRecovery,
  nativeGetLastAccountId: nativeMocks.nativeGetLastAccountId,
  nativeSetLastAccountId: nativeMocks.nativeSetLastAccountId,
  nativeClaimRestAlert: nativeMocks.nativeClaimRestAlert
}));

import {
  IndexedDbRecoveryStorage,
  NativeRecoveryStorage,
  getRecoveryStorage,
  migrateIndexedDbToNativeIfNeeded
} from './recoveryStorage';

const session: Session = {
  id: 'workout-1', templateId: null, programId: null, name: 'Workout', note: '', active: true,
  startedAt: '2026-09-28T08:00:00.000Z', finishedAt: null, pausedAt: null, pausedSeconds: 0, revision: 1,
  exercises: [], volumeKg: null, completedSets: 0, warmupSets: 0
};

const sampleRecord: WorkoutRecoveryRecord = {
  schemaVersion: 1,
  accountId: 'account-1',
  displayName: 'User',
  sessionId: 'workout-1',
  draft: session,
  serverSession: session,
  preferences: { unit: 'kg', theme: 'dark', restAlerts: false },
  activeIndex: 0,
  viewMode: 'focus',
  conflict: false,
  operations: [],
  rest: null,
  updatedAt: '2026-09-28T08:00:00.000Z'
};

describe('recoveryStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeMocks.isNative.mockReturnValue(false);
    localStorage.clear();
  });

  describe('IndexedDbRecoveryStorage', () => {
    it('claims rest alert generations idempotently', async () => {
      const storage = new IndexedDbRecoveryStorage();
      const gen1 = 'alert-gen-1';
      expect(await storage.claimRestAlert('workout-1', gen1)).toBe(true);
      expect(await storage.claimRestAlert('workout-1', gen1)).toBe(false);
      expect(await storage.claimRestAlert('workout-1', '')).toBe(false);
    });
  });

  describe('NativeRecoveryStorage', () => {
    it('delegates put and delete to native bridge', async () => {
      const storage = new NativeRecoveryStorage();
      nativeMocks.nativeSaveRecovery.mockResolvedValueOnce(undefined);
      nativeMocks.nativeDeleteRecovery.mockResolvedValueOnce(undefined);

      await storage.put(sampleRecord);
      expect(nativeMocks.nativeSaveRecovery).toHaveBeenCalledWith('account-1', 'workout-1', JSON.stringify(sampleRecord));

      await storage.delete('account-1');
      expect(nativeMocks.nativeDeleteRecovery).toHaveBeenCalledWith('account-1');
    });

    it('delegates get and validates schema from native bridge JSON', async () => {
      const storage = new NativeRecoveryStorage();
      nativeMocks.nativeGetRecovery.mockResolvedValueOnce(JSON.stringify(sampleRecord));

      const result = await storage.get('account-1');
      expect(result).toEqual(sampleRecord);
      expect(nativeMocks.nativeGetRecovery).toHaveBeenCalledWith('account-1');
    });

    it('returns null on invalid or corrupted JSON from native bridge', async () => {
      const storage = new NativeRecoveryStorage();
      nativeMocks.nativeGetRecovery.mockResolvedValueOnce('invalid json');
      expect(await storage.get('account-1')).toBeNull();

      nativeMocks.nativeGetRecovery.mockResolvedValueOnce(JSON.stringify({ ...sampleRecord, schemaVersion: 999 }));
      expect(await storage.get('account-1')).toBeNull();

      nativeMocks.nativeGetRecovery.mockResolvedValueOnce(JSON.stringify({ ...sampleRecord, accountId: 'wrong-account' }));
      expect(await storage.get('account-1')).toBeNull();

      nativeMocks.nativeGetRecovery.mockResolvedValueOnce(null);
      expect(await storage.get('account-1')).toBeNull();
    });

    it('delegates last account id operations and rest claim', async () => {
      const storage = new NativeRecoveryStorage();
      nativeMocks.nativeGetLastAccountId.mockResolvedValueOnce('account-1');
      nativeMocks.nativeSetLastAccountId.mockResolvedValueOnce(undefined);
      nativeMocks.nativeClaimRestAlert.mockResolvedValueOnce(true);

      expect(await storage.getLastAccountId()).toBe('account-1');
      await storage.setLastAccountId('account-2');
      expect(nativeMocks.nativeSetLastAccountId).toHaveBeenCalledWith('account-2');

      expect(await storage.claimRestAlert('workout-1', 'gen-123')).toBe(true);
      expect(nativeMocks.nativeClaimRestAlert).toHaveBeenCalledWith('workout-1', 'gen-123');
    });
  });

  describe('getRecoveryStorage', () => {
    it('uses native storage only when the app provides the workout plugin', () => {
      nativeMocks.isNative.mockReturnValue(false);
      const webStorage = getRecoveryStorage();
      expect(webStorage).toBeInstanceOf(IndexedDbRecoveryStorage);

      nativeMocks.isNative.mockReturnValue(true);
      const nativeStorage = getRecoveryStorage();
      expect(nativeStorage).toBeInstanceOf(NativeRecoveryStorage);
    });
  });

  describe('migrateIndexedDbToNativeIfNeeded', () => {
    it('skips migration when not running natively', async () => {
      nativeMocks.isNative.mockReturnValue(false);
      const storage = new NativeRecoveryStorage();
      await migrateIndexedDbToNativeIfNeeded(storage);
      expect(nativeMocks.nativeSaveRecovery).not.toHaveBeenCalled();
    });

    it('skips migration when already marked as migrated', async () => {
      nativeMocks.isNative.mockReturnValue(true);
      localStorage.setItem('workout_native_storage_migrated_v1', 'true');
      const storage = new NativeRecoveryStorage();
      await migrateIndexedDbToNativeIfNeeded(storage);
      expect(nativeMocks.nativeSaveRecovery).not.toHaveBeenCalled();
    });

    it('moves a browser-stored workout into native storage without waiting on itself', async () => {
      nativeMocks.isNative.mockReturnValue(true);
      localStorage.removeItem('workout_native_storage_migrated_v1');
      const record = { accountId: 'account-1', sessionId: 'workout-1', schemaVersion: 1, operations: [],
        draft: { id: 'workout-1' }, serverSession: { id: 'workout-1' } } as unknown as WorkoutRecoveryRecord;
      vi.spyOn(IndexedDbRecoveryStorage.prototype, 'getLastAccountId').mockResolvedValue('account-1');
      vi.spyOn(IndexedDbRecoveryStorage.prototype, 'get').mockResolvedValue(record);
      const removed = vi.spyOn(IndexedDbRecoveryStorage.prototype, 'delete').mockResolvedValue();
      let stored: string | null = null;
      nativeMocks.nativeGetRecovery.mockImplementation(async () => stored);
      nativeMocks.nativeSaveRecovery.mockImplementation(async (_account: string, _session: string, json: string) => { stored = json; });

      await migrateIndexedDbToNativeIfNeeded(new NativeRecoveryStorage());

      expect(JSON.parse(stored!).sessionId).toBe('workout-1');
      expect(removed).toHaveBeenCalledWith('account-1');
      expect(localStorage.getItem('workout_native_storage_migrated_v1')).toBe('true');
    });
  });
});
