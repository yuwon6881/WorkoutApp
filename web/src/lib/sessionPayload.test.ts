import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { sessionPayload } from './workoutOutbox';
import { sameWorkoutEdits } from './workoutRecoveryComparison';

const session = (restSeconds?: number | null): Session => ({
  id: 'w1', templateId: 'd1', programId: 'p1', name: 'Legs', note: '', active: true, startedAt: '2026-10-04T08:00:00.000Z',
  finishedAt: null, pausedAt: null, pausedSeconds: 0, revision: 3, volumeKg: null, completedSets: 0, warmupSets: 0,
  exercises: [{
    id: 'e1', exerciseId: 'curl', name: 'Lying Leg Curl', position: 0, note: '', prescription: [], sequenceGroup: '',
    substitutions: [], progression: null, ...(restSeconds === undefined ? {} : { restSeconds }),
    sets: [{ id: 's1', position: 0, weightKg: 40, reps: 10, rpe: null, done: true, warmup: false }]
  }]
});

describe('saving a whole workout', () => {
  it('sends each exercise rest timer so a save cannot erase it', () => {
    expect(sessionPayload(session(120), 3, 'k').exercises[0].restSeconds).toBe(120);
  });

  it('sends null, not a missing field, for an exercise with no rest timer of its own', () => {
    expect(sessionPayload(session(null), 3, 'k').exercises[0].restSeconds).toBeNull();
    expect(sessionPayload(session(), 3, 'k').exercises[0].restSeconds).toBeNull();
  });

  it('treats a changed rest timer as a real difference between two copies of the workout', () => {
    expect(sameWorkoutEdits(session(90), session(120))).toBe(false);
    expect(sameWorkoutEdits(session(null), session())).toBe(true);
  });
});
