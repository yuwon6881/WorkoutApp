import { describe, expect, it } from 'vitest';
import type { WorkoutRecoveryRecord } from './workoutRecovery';
import type { NativeRestAction } from './platform';
import { projectNativeRestActions } from './nativeRestImport';

const baseline = () => ({
  accountId: 'account', sessionId: 'session', conflict: false, operations: [],
  draft: { active: true, finishedAt: null }, serverSession: { revision: 3 },
  rest: { generation: 'g', status: 'running', deadlineUtc: new Date(100000).toISOString(), durationMs: 90000 }
} as unknown as WorkoutRecoveryRecord);
const tap = (id = 'one', generation = 'g', resultingGeneration = 'g2'): NativeRestAction => ({
  id, accountId: 'account', sessionId: 'session', generation, resultingGeneration,
  kind: 'extend', seconds: 30, atMs: 1000
});

describe('durable native rest import projection', () => {
  it('uses the recovery baseline, stable mutation ID, original time and resulting generation', () => {
    const next = projectNativeRestActions(baseline(), [tap()]);
    expect(next.record.rest?.deadlineUtc).toBe(new Date(130000).toISOString());
    expect(next.record.operations[0]).toMatchObject({ id: 'one', createdAt: new Date(1000).toISOString(),
      rest: { generation: 'g2', occurredAt: new Date(1000).toISOString() } });
    expect(baseline().operations).toEqual([]);
  });

  it('chains actions once in persisted order and ignores duplicate delivery', () => {
    const next = projectNativeRestActions(baseline(), [tap(), tap('two', 'g2', 'g3'), tap()]);
    expect(next.record.operations.map(item => item.id)).toEqual(['one', 'two']);
    expect(next.record.rest?.generation).toBe('g3');
    expect(next.record.rest?.deadlineUtc).toBe(new Date(160000).toISOString());
    const again = projectNativeRestActions(next.record, [tap(), tap('two', 'g2', 'g3')]);
    expect(again.record.operations).toHaveLength(2);
    expect(again.record.rest).toEqual(next.record.rest);
  });

  it('retains pending actions during conflict and missing recovery', () => {
    expect(() => projectNativeRestActions({ ...baseline(), conflict: true }, [tap()])).toThrow(/review/i);
  });

  it('never imports another account or session and explicitly classifies replaced rests', () => {
    const next = projectNativeRestActions(baseline(), [tap('old', 'replaced'), { ...tap(), accountId: 'other' },
      { ...tap(), sessionId: 'other' }]);
    expect(next.record.operations).toEqual([]);
    expect(next.importedIds).toEqual(['old']);
    expect(next.supersededIds).toEqual(['old']);
  });

  it('supersedes finished workouts without restarting rest', () => {
    const record = baseline();
    record.draft.active = false;
    const next = projectNativeRestActions(record, [tap()]);
    expect(next.supersededIds).toEqual(['one']);
    expect(next.record.rest).toEqual(record.rest);
    const finishedElsewhere = baseline();
    finishedElsewhere.serverSession.active = false;
    expect(projectNativeRestActions(finishedElsewhere, [tap()]).supersededIds).toEqual(['one']);
  });

  it('an extension uses the occurrence time after the previous deadline', () => {
    const next = projectNativeRestActions(baseline(), [{ ...tap(), atMs: 200000 }]);
    expect(next.record.rest?.deadlineUtc).toBe(new Date(230000).toISOString());
  });
});
