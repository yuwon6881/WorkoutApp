import type { Session } from '../types';
import { api } from './api';

/// A press on a history row starts the read before the tap completes, and the summary that opens
/// on the tap picks up the same request. Entries are kept only briefly and only in memory: this is
/// request sharing, not a history cache.
const KEEP_MS = 60_000;
const LIMIT = 8;
const reads = new Map<string, { at: number; promise: Promise<Session> }>();

export function loadSessionDetail(id: string): Promise<Session> {
  const now = Date.now();
  const existing = reads.get(id);
  if (existing && now - existing.at < KEEP_MS) return existing.promise;

  const promise = api.getWorkout(id);
  reads.set(id, { at: now, promise });
  promise.catch(() => { if (reads.get(id)?.promise === promise) reads.delete(id); });
  while (reads.size > LIMIT) reads.delete(reads.keys().next().value!);
  return promise;
}

/// Starts the read without waiting on it; a failure is reported when the summary asks for it.
export function prefetchSessionDetail(id: string): void {
  loadSessionDetail(id).catch(() => undefined);
}

export function forgetSessionDetail(id?: string): void {
  if (id) reads.delete(id);
  else reads.clear();
}

/// History lists carry summary rows; their exercises and sets arrive with the full session.
export const isSessionSummary = (session: Session): boolean =>
  !session.active && session.exercises.length === 0 && session.completedSets > 0;
