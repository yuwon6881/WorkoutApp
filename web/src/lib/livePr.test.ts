import { describe, expect, it } from 'vitest';
import type { LoggedSet, SessionExercise } from '../types';
import { checkLivePr, formatExercisePrBadge, formatSetPrTag, newBestAfterLogging } from './livePr';

function set(patch: Partial<LoggedSet>): LoggedSet {
  return { id: crypto.randomUUID(), position: 0, weightKg: 60, reps: 5, rpe: 8, done: true, warmup: false, ...patch };
}

function exercise(
  sets: LoggedSet[],
  previousBestE1rmKg: number | null = null,
  previousRepBests: Record<string, number> | null = null,
  loadModel: SessionExercise['loadModel'] = 'external',
  previousRepRecords: SessionExercise['previousRepRecords'] = null
): SessionExercise {
  const resistanceMode = sets[0]?.resistanceMode ?? (loadModel === 'full_bodyweight' ? 'bodyweight'
    : loadModel === 'reps_only' || loadModel === 'bodyweight_context_only' ? 'reps_only' : 'external');
  return {
    id: 'e',
    exerciseId: 'bench',
    name: 'Bench',
    position: 0,
    note: '',
    prescription: [],
    sets,
    sequenceGroup: '',
    substitutions: [],
    progression: null,
    previousBestE1rmKg,
    previousRepBests,
    previousRepRecords: previousRepRecords ?? (previousRepBests ? Object.entries(previousRepBests).map(([load, reps]) => ({
      loadModel: loadModel ?? 'external', resistanceMode,
      loadKg: load === 'reps_only' ? null : Number(load), reps
    })) : null),
    loadModel
  };
}

describe('live personal bests', () => {
  it('reports a working set that beats previous e1RM', () => {
    // 65 x 5 @ 8 -> 65 * (1 + 7/30) = 80.17, above a previous best of 74.
    expect(newBestAfterLogging(exercise([set({ weightKg: 65 })], 74), 0)).toBeCloseTo(80.17, 2);
    const pr = checkLivePr(exercise([set({ weightKg: 65 })], 74), 0);
    expect(pr).not.toBeNull();
    expect(pr?.kind).toBe('e1rm');
    expect(pr?.e1rm).toBeCloseTo(80.17, 2);
  });

  it('says nothing without finished history, for warm-ups, or for an equal estimate', () => {
    expect(newBestAfterLogging(exercise([set({ weightKg: 65 })], null), 0)).toBeNull();
    expect(newBestAfterLogging(exercise([set({ weightKg: 65, warmup: true })], 74), 0)).toBeNull();
    expect(newBestAfterLogging(exercise([set({ weightKg: 60 })], 74), 0)).toBeNull();

    expect(checkLivePr(exercise([set({ weightKg: 65 })], null), 0)).toBeNull();
    expect(checkLivePr(exercise([set({ weightKg: 65, warmup: true })], 74), 0)).toBeNull();
  });

  it('reports separate rep PR at same load even when e1RM is not a PR', () => {
    // 60kg x 8 reps, previous rep best at 60kg was 6 reps. Previous e1RM is 100 (so 60x8 isn't e1RM PR)
    const ex = exercise([set({ weightKg: 60, reps: 8, rpe: 8 })], 100, { '60': 6 });
    const pr = checkLivePr(ex, 0);
    expect(pr).not.toBeNull();
    expect(pr?.kind).toBe('reps');
    expect(pr?.reps).toBe(8);
    expect(pr?.loadKg).toBe(60);
  });

  it('reports rep PR when reps exceed 12-effective-rep boundary (where e1RM is null)', () => {
    // 50kg x 12 @ RPE 8 -> effective reps = 14 > 12 -> e1RM is null
    // Previous rep best at 50kg was 10 reps
    const ex = exercise([set({ weightKg: 50, reps: 12, rpe: 8 })], 80, { '50': 10 });
    const pr = checkLivePr(ex, 0);
    expect(pr).not.toBeNull();
    expect(pr?.kind).toBe('reps');
    expect(pr?.reps).toBe(12);
  });

  it('reports both e1RM and Rep PR when both bars are cleared', () => {
    // 70kg x 8 @ RPE 9 -> e1RM = 70 * (1 + 9/30) = 91. Prev e1RM = 85.
    // Previous rep best at 70kg was 6 reps.
    const ex = exercise([set({ weightKg: 70, reps: 8, rpe: 9 })], 85, { '70': 6 });
    const pr = checkLivePr(ex, 0);
    expect(pr).not.toBeNull();
    expect(pr?.kind).toBe('both');
    expect(pr?.reps).toBe(8);
    expect(pr?.e1rm).toBeCloseTo(91, 1);
  });

  it('does not award rep PR on tie', () => {
    const ex = exercise([set({ weightKg: 60, reps: 8, rpe: 8 })], 100, { '60': 8 });
    const pr = checkLivePr(ex, 0);
    expect(pr).toBeNull();
  });

  it('supports full bodyweight exercises using systemLoadKg', () => {
    // Bodyweight exercise: systemLoadKg is 85kg
    const ex = exercise(
      [set({ weightKg: 0, systemLoadKg: 85, reps: 10, rpe: 8 })],
      null,
      { '85': 8 },
      'full_bodyweight'
    );
    const pr = checkLivePr(ex, 0);
    expect(pr).not.toBeNull();
    expect(pr?.kind).toBe('reps');
    expect(pr?.reps).toBe(10);
    expect(pr?.loadKg).toBe(85);
  });

  it('does not compare rep records across assistance and added-load conventions at the same system load', () => {
    const ex = exercise(
      [set({ weightKg: 15, systemLoadKg: 85, reps: 12, resistanceMode: 'added' })],
      null,
      null,
      'full_bodyweight',
      [{ loadModel: 'full_bodyweight', resistanceMode: 'assistance', loadKg: 85, reps: 8 }]
    );
    expect(checkLivePr(ex, 0)).toBeNull();
  });

  it('requires frozen system load for a full-bodyweight rep record', () => {
    const ex = exercise(
      [set({ weightKg: null, systemLoadKg: null, reps: 15, rpe: null, resistanceMode: 'bodyweight' })],
      null,
      null,
      'full_bodyweight',
      [{ loadModel: 'full_bodyweight', resistanceMode: 'bodyweight', loadKg: 85, reps: 12 }]
    );
    expect(checkLivePr(ex, 0)).toBeNull();
  });

  it('records 15 to 30 rep sets without requiring RPE or an e1RM estimate', () => {
    const ex = exercise(
      [set({ weightKg: 20, reps: 30, rpe: null })],
      null,
      null,
      'external',
      [{ loadModel: 'external', resistanceMode: 'external', loadKg: 20, reps: 29 }]
    );
    expect(checkLivePr(ex, 0)).toEqual({ kind: 'reps', e1rm: null, reps: 30, loadKg: 20, isRepsOnly: false });
  });

  it('does not use a different load model as a rep baseline', () => {
    const ex = exercise(
      [set({ weightKg: 85, reps: 12 })], null, null, 'external',
      [{ loadModel: 'full_bodyweight', resistanceMode: 'bodyweight', loadKg: 85, reps: 8 }]
    );
    expect(checkLivePr(ex, 0)).toBeNull();
  });

  it('supports reps_only exercises using reps_only loadKey', () => {
    const ex = exercise(
      [set({ weightKg: null, reps: 25, rpe: 8 })],
      null,
      { reps_only: 20 },
      'reps_only'
    );
    const pr = checkLivePr(ex, 0);
    expect(pr).not.toBeNull();
    expect(pr?.kind).toBe('reps');
    expect(pr?.reps).toBe(25);
    expect(pr?.isRepsOnly).toBe(true);
  });

  it('reports each improvement once intra-session', () => {
    // When set 0 is logged, set 1 is not yet done
    const ex1 = exercise([
      set({ weightKg: 70, reps: 8, done: true }),
      set({ weightKg: 70, reps: 8, done: false }),
      set({ weightKg: 70, reps: 9, done: false })
    ], 74, { '70': 6 });
    expect(checkLivePr(ex1, 0)).not.toBeNull();

    // When set 1 is logged, set 0 is already done with same reps/load -> not a new PR
    const ex2 = exercise([
      set({ weightKg: 70, reps: 8, done: true }),
      set({ weightKg: 70, reps: 8, done: true }),
      set({ weightKg: 70, reps: 9, done: false })
    ], 74, { '70': 6 });
    expect(checkLivePr(ex2, 1)).toBeNull();

    // When set 2 is logged, it beats set 0 and set 1 -> new PR
    const ex3 = exercise([
      set({ weightKg: 70, reps: 8, done: true }),
      set({ weightKg: 70, reps: 8, done: true }),
      set({ weightKg: 70, reps: 9, done: true })
    ], 74, { '70': 6 });
    expect(checkLivePr(ex3, 2)).not.toBeNull();
  });
});

describe('PR badge and tag formatting', () => {
  it('formats exercise badge for rep best', () => {
    const ex: SessionExercise = {
      ...exercise([]),
      isPr: true,
      prKind: 'reps',
      prReps: 15
    };
    expect(formatExercisePrBadge(ex, 'kg')).toBe('Rep best · 15 reps');
  });

  it('formats exercise badge for estimated strength best', () => {
    const ex: SessionExercise = {
      ...exercise([]),
      isPr: true,
      prKind: 'e1rm',
      prE1rmKg: 100
    };
    expect(formatExercisePrBadge(ex, 'kg')).toBe('Estimated strength best · 100 kg e1RM');
  });

  it('formats exercise badge for both', () => {
    const ex: SessionExercise = {
      ...exercise([]),
      isPr: true,
      prKind: 'both',
      prE1rmKg: 100,
      prReps: 12
    };
    expect(formatExercisePrBadge(ex, 'kg')).toBe('Strength & rep best · 100 kg e1RM · 12 reps');
  });

  it('formats set PR tag', () => {
    expect(formatSetPrTag(set({ prKind: 'reps' }))).toBe('Rep best');
    expect(formatSetPrTag(set({ prKind: 'e1rm' }))).toBe('Estimated strength best');
    expect(formatSetPrTag(set({ prKind: 'both' }))).toBe('Strength & rep best');
    expect(formatSetPrTag(set({ isPr: true }))).toBe('PR');
  });
});
