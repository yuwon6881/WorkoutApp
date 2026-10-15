import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { checkLivePr } from './livePr';
import { withSessionSystemLoads } from './workoutSystemLoads';

function workout(name = 'Weighted Pull-Up', weightKg: number | null = 10): Session {
  return {
    id: 'session', templateId: null, programId: null, name: 'Workout', note: '', active: true,
    startedAt: '2026-10-15T08:00:00Z', finishedAt: null, revision: 1,
    volumeKg: null, completedSets: 0, warmupSets: 0,
    bodyWeight: { referenceKg: 80, referenceSource: 'scale', referenceDate: '2026-10-15',
      scaleWeightKg: 80, scaleDate: '2026-10-15', trendWeightKg: null, trendDate: null,
      calculationVersion: 'v1', nutritionRevision: 1, capturedAt: '2026-10-15T08:00:00Z' },
    exercises: [{ id: 'exercise', exerciseId: 'pull-up', name, position: 0, note: '',
      loadModel: 'full_bodyweight', prescription: [], sequenceGroup: '', substitutions: [], progression: null,
      previousBestE1rmKg: 105,
      previousRepRecords: [{ loadModel: 'full_bodyweight', resistanceMode: 'added', loadKg: 90, reps: 4 }],
      sets: [{ id: 'set', position: 0, weightKg, reps: 5, rpe: 8, done: true, warmup: false,
        resistanceMode: 'added', systemLoadKg: 85 }] }]
  };
}

describe('active workout system loads', () => {
  it('replaces stale suggestion totals before checking strength and same-load rep records', () => {
    const original = workout();
    const updated = withSessionSystemLoads(original);
    expect(updated.exercises[0].sets[0].systemLoadKg).toBe(90);
    expect(checkLivePr(updated.exercises[0], 0)).toMatchObject({ kind: 'both', loadKg: 90, reps: 5 });
    expect(original.exercises[0].sets[0].systemLoadKg).toBe(85);
  });

  it('derives totals for new exercises and copied sets with no server prefill, including zero added load', () => {
    const session = workout('Weighted Pull-Up', 0);
    delete session.exercises[0].sets[0].systemLoadKg;
    expect(withSessionSystemLoads(session).exercises[0].sets[0].systemLoadKg).toBe(80);
  });

  it.each([
    ['Assisted Pull-Up', 20, 60, 'assistance'],
    ['Assisted Pull-Up', 100, 0, 'assistance'],
    ['Pull-Up', null, 80, 'bodyweight'],
    ['Weighted Pull-Up', null, null, 'added']
  ] as const)('mirrors server loading for %s at %s', (name, weight, total, mode) => {
    expect(withSessionSystemLoads(workout(name, weight)).exercises[0].sets[0])
      .toMatchObject({ systemLoadKg: total, resistanceMode: mode });
  });

  it('clears stale totals when the frozen snapshot is missing, without guessing from suggestions', () => {
    const session = workout();
    session.bodyWeight = null;
    const exercise = withSessionSystemLoads(session).exercises[0];
    expect(exercise.sets[0].systemLoadKg).toBeNull();
    expect(checkLivePr(exercise, 0)).toBeNull();
  });

  it('keeps external exercises untouched and reuses an already correct session', () => {
    const session = workout();
    session.exercises[0].loadModel = 'external';
    expect(withSessionSystemLoads(session)).toBe(session);
    const normalized = withSessionSystemLoads(workout());
    expect(withSessionSystemLoads(normalized)).toBe(normalized);
  });
});
