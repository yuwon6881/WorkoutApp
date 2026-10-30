import { describe, expect, it } from 'vitest';
import { skippedRest, startedRest } from './restMutations';

describe('rest mutations', () => {
  it('describes a started rest by one generation shared by the mutation and the saved state', () => {
    const rest = startedRest(90, 4, Date.parse('2026-01-01T10:00:00Z'));
    expect(rest.mutation).toMatchObject({ revision: 4, action: 'start', seconds: 90, generation: rest.generation, occurredAt: '2026-01-01T10:00:00.000Z' });
    expect(rest.state).toMatchObject({ generation: rest.generation, status: 'running', deadlineUtc: '2026-01-01T10:01:30.000Z', durationMs: 90000 });
  });

  it('describes a skip with no seconds', () => {
    expect(skippedRest(7, 0)).toMatchObject({ revision: 7, action: 'skip', occurredAt: '1970-01-01T00:00:00.000Z' });
    expect(skippedRest(7)).not.toHaveProperty('seconds');
  });
});
