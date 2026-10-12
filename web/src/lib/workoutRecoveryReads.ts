import { getRecoveryStorage } from './recoveryStorage';
import type { WorkoutRecoveryRecord } from './workoutRecovery';

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
