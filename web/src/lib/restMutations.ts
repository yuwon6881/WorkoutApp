import type { RestMutationInput, SessionRest } from '../types';

/// A rest a logged set starts, as the server mutation and the rest state saved with the set.
export function startedRest(seconds: number, revision: number, now = Date.now()): { generation: string; mutation: RestMutationInput; state: SessionRest } {
  const generation = crypto.randomUUID();
  return {
    generation,
    mutation: { revision, action: 'start', seconds, generation, occurredAt: new Date(now).toISOString() },
    state: {
      generation,
      status: 'running',
      deadlineUtc: new Date(now + seconds * 1000).toISOString(),
      pausedRemainingMs: null,
      durationMs: seconds * 1000,
      originDeviceId: null
    }
  };
}

/// Ends the running rest for every device; the saved rest state is then empty.
export function skippedRest(revision: number, now = Date.now()): RestMutationInput {
  return { revision, action: 'skip', generation: crypto.randomUUID(), occurredAt: new Date(now).toISOString() };
}
