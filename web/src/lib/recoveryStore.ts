import type { WorkoutRecoveryRecord } from './workoutRecovery';
import { hasUnresolvedRecovery } from './workoutRecoveryComparison';

/** The logger observes every durable edit. The shell observes only changes it can present. */
export class RecoveryStore {
  private value: WorkoutRecoveryRecord | null = null;
  private shell = 'null';
  private listeners = new Set<() => void>();
  getSnapshot = () => this.value;
  getShellSnapshot = () => this.shell;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  set = (record: WorkoutRecoveryRecord | null) => {
    this.value = record;
    this.shell = record ? JSON.stringify([record.accountId, record.sessionId, record.conflict,
      hasUnresolvedRecovery(record), record.operations.some(operation => operation.type === 'finish'),
      record.draft.active, record.draft.finishedAt, record.draft.name, record.draft.pausedAt, record.draft.pausedSeconds, record.rest,
      record.preferences]) : 'null';
    for (const listener of this.listeners) listener();
  };
}
