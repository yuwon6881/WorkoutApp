import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutRecoveryRecord } from './workoutRecovery';
import type { NativeRestAction } from './platform';

const device = vi.hoisted(() => ({
  records: new Map<string, WorkoutRecoveryRecord>(), actions: [] as NativeRestAction[],
  fail: false, stale: 0, commits: 0
}));
vi.mock('./recoveryStorage', () => ({ getRecoveryStorage: () => ({
  get: async (account: string) => structuredClone(device.records.get(account) ?? null),
  put: async (record: WorkoutRecoveryRecord) => { device.records.set(record.accountId, structuredClone(record)); }
}) }));
vi.mock('./platform', () => ({
  readNativeRestActions: async () => structuredClone(device.actions),
  commitNativeRestImport: async (input: { accountId: string; expectedJson: string; recordJson: string; importedIds: string[] }) => {
    if (device.fail) throw new Error('Disk unavailable');
    if (device.stale-- > 0) {
      device.records.get(input.accountId)!.activeIndex++;
      return false;
    }
    if (JSON.stringify(device.records.get(input.accountId)) !== input.expectedJson) return false;
    device.records.set(input.accountId, JSON.parse(input.recordJson) as WorkoutRecoveryRecord);
    device.actions = device.actions.filter(action => !input.importedIds.includes(action.id!));
    device.commits++;
    return true;
  }
}));
import { importNativeRestActions } from './nativeRestImport';
import { writeRecoveryMutation } from './workoutRecovery';

beforeEach(() => {
  device.records.clear();
  device.records.set('account', {
    accountId: 'account', sessionId: 'session', conflict: false, activeIndex: 0, operations: [],
    draft: { active: true, finishedAt: null }, serverSession: { revision: 1 },
    rest: { generation: 'g', status: 'running', deadlineUtc: new Date(100000).toISOString(), durationMs: 90000 }
  } as unknown as WorkoutRecoveryRecord);
  device.actions = [{ id: 'tap', accountId: 'account', sessionId: 'session', generation: 'g', resultingGeneration: 'g2',
    kind: 'extend', seconds: 30, atMs: 1000 }];
  device.fail = false;
  device.stale = 0;
  device.commits = 0;
});

describe('native action import coordination', () => {
  it('retains work after failure and imports it once after reopening', async () => {
    device.fail = true;
    await expect(importNativeRestActions('account', 'session')).rejects.toThrow('Disk');
    expect(device.actions).toHaveLength(1);
    expect(device.records.get('account')!.operations).toHaveLength(0);
    device.fail = false;
    await importNativeRestActions('account', 'session');
    await importNativeRestActions('account', 'session');
    expect(device.records.get('account')!.operations.map(item => item.id)).toEqual(['tap']);
    expect(device.commits).toBe(1);
  });

  it('serializes concurrent resume, notification events and ordinary recovery edits', async () => {
    await Promise.all([
      importNativeRestActions('account', 'session'),
      writeRecoveryMutation('account', async () => { device.records.get('account')!.activeIndex = 7; }),
      importNativeRestActions('account', 'session')
    ]);
    expect(device.records.get('account')!.activeIndex).toBe(7);
    expect(device.records.get('account')!.operations).toHaveLength(1);
    expect(device.commits).toBe(1);
  });

  it('rereads stale recovery without dropping another writer', async () => {
    device.stale = 1;
    await importNativeRestActions('account', 'session');
    expect(device.records.get('account')!.activeIndex).toBe(1);
    expect(device.records.get('account')!.operations).toHaveLength(1);
  });

  it('retains actions while recovery is absent or conflicted', async () => {
    device.records.get('account')!.conflict = true;
    await expect(importNativeRestActions('account', 'session')).rejects.toThrow('Review');
    device.records.clear();
    await expect(importNativeRestActions('account', 'session')).rejects.toThrow('not available');
    expect(device.actions).toHaveLength(1);
    expect(device.commits).toBe(0);
  });

  it('does not read another account into the current workout', async () => {
    expect(await importNativeRestActions('other', 'session')).toBeNull();
    expect(device.actions).toHaveLength(1);
  });
});
