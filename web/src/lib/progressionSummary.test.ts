import { describe, expect, it } from 'vitest';
import type { Session, NutritionTrainingContext, SessionExercise } from '../types';
import { getProgressionSummary } from './progressionSummary';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session',
    templateId: null,
    programId: null,
    name: 'Workout A',
    note: '',
    active: true,
    startedAt: '2026-03-30T10:00:00Z',
    finishedAt: null,
    revision: 1,
    exercises: [],
    volumeKg: 0,
    completedSets: 0,
    warmupSets: 0,
    ...overrides
  };
}

function makeNutrition(overrides: Partial<NutritionTrainingContext> = {}): NutritionTrainingContext {
  return {
    subject: 'user-1',
    revision: 1,
    timeZone: 'UTC',
    effectiveGoal: 'gain',
    phaseComplete: false,
    targetRatePercent: null,
    observedLossRatePercent: null,
    observedWindowDays: null,
    scaleWeightKg: 80,
    scaleWeightDate: null,
    trendWeightKg: 80,
    trendWeightDate: null,
    retrievedAt: '2026-03-30T10:00:00Z',
    confirmed: true,
    ...overrides
  };
}

describe('getProgressionSummary', () => {
  it('returns null for an empty session with no nutrition context', () => {
    const session = makeSession();
    expect(getProgressionSummary(session)).toBeNull();
  });

  it('formats gain goal with normal progression', () => {
    const session = makeSession({
      nutritionContext: makeNutrition({ effectiveGoal: 'gain' })
    });
    const summary = getProgressionSummary(session);
    expect(summary).not.toBeNull();
    expect(summary?.label).toBe('Gain goal · Normal progression');
    expect(summary?.mode).toBe('normal');
    expect(summary?.reason).toContain('does not verify a calorie surplus');
  });

  it('formats maintenance goal with normal progression', () => {
    const session = makeSession({
      nutritionContext: makeNutrition({ effectiveGoal: 'maintain' })
    });
    const summary = getProgressionSummary(session);
    expect(summary?.label).toBe('Maintenance goal · Normal progression');
    expect(summary?.mode).toBe('normal');
    expect(summary?.reason).toContain('maintenance goal');
  });

  it.each([
    ['maintain', 0.6, 14, 'conservative'],
    ['gain', 0.5, 21, 'conservative'],
    ['gain', 0.49, 21, 'normal'],
    ['maintain', 0.6, 7, 'normal'],
    ['maintain', -0.4, 21, 'normal'],
    ['maintain', null, null, 'normal']
  ] as const)('mirrors the server guard for an unplanned loss on a %s goal (%s%%/wk over %s days)', (goal, rate, days, mode) => {
    const summary = getProgressionSummary(makeSession({
      nutritionContext: makeNutrition({ effectiveGoal: goal, observedLossRatePercent: rate, observedWindowDays: days })
    }));
    expect(summary?.mode).toBe(mode);
    if (mode === 'conservative') {
      expect(summary?.reason).toContain('recorded weigh-ins show a loss');
      expect(summary?.reason).toContain('conservative progression');
    }
  });

  it('formats loss goal with conservative progression for a moderate recorded rate', () => {
    const session = makeSession({
      nutritionContext: makeNutrition({
        effectiveGoal: 'lose',
        targetRatePercent: 0.5
      })
    });
    const summary = getProgressionSummary(session);
    expect(summary?.label).toBe('Loss goal · Conservative progression');
    expect(summary?.mode).toBe('conservative');
    expect(summary?.reason).toContain('recorded rate below 0.75% per week');
    expect(summary?.reason).toContain('requires 2 qualifying exposures');
  });

  it('formats loss goal with preservation progression for a higher recorded rate', () => {
    const session = makeSession({
      nutritionContext: makeNutrition({
        effectiveGoal: 'lose',
        targetRatePercent: 0.8
      })
    });
    const summary = getProgressionSummary(session);
    expect(summary?.label).toBe('Loss goal · Preservation progression');
    expect(summary?.mode).toBe('preservation');
    expect(summary?.reason).toContain('0.80% per week');
  });

  it('derives preservation mode from exercise progression suggestions even without nutrition context', () => {
    const exercise: SessionExercise = {
      id: 'ex-1',
      exerciseId: 'bench',
      name: 'Bench Press',
      position: 0,
      note: '',
      prescription: [],
      sets: [
        {
          id: 's-1',
          position: 0,
          weightKg: 80,
          reps: 8,
          rpe: 8,
          done: false,
          warmup: false,
          suggestion: {
            suggestedLoadKg: 80,
            suggestedReps: 8,
            reason: 'Held load',
            sourceSessionId: null,
            sourceDate: null,
            progressionMode: 'preservation',
            nutritionContextRevision: null,
            isBodyweightAdjustment: false,
            suggestedSystemLoadKg: null,
            resistanceMode: 'external'
          }
        }
      ],
      sequenceGroup: '',
      substitutions: [],
      progression: null
    };

    const session = makeSession({ exercises: [exercise] });
    const summary = getProgressionSummary(session);
    expect(summary?.label).toBe('Preservation progression');
    expect(summary?.mode).toBe('preservation');
    expect(summary?.reason).toContain('Held load');
  });

  it('combines nutrition goal with stored suggestion mode', () => {
    const exercise: SessionExercise = {
      id: 'ex-1',
      exerciseId: 'squat',
      name: 'Squat',
      position: 0,
      note: '',
      prescription: [],
      sets: [],
      sequenceGroup: '',
      substitutions: [],
      progression: {
        suggestedKg: 100,
        targetReps: 5,
        reason: 'Conservative advance',
        lastE1rmKg: 120,
        trendE1rmKg: 120,
        stepKg: 2.5,
        mode: 'conservative'
      }
    };

    const session = makeSession({
      exercises: [exercise],
      nutritionContext: makeNutrition({ effectiveGoal: 'lose' })
    });
    const summary = getProgressionSummary(session);
    expect(summary?.label).toBe('Loss goal · Conservative progression');
    expect(summary?.mode).toBe('conservative');
  });

  it('uses the actual exercise-level mode field returned by the API', () => {
    const exercise: SessionExercise = {
      id: 'ex-1', exerciseId: 'bench', name: 'Bench Press', position: 0, note: '',
      prescription: [], sets: [], sequenceGroup: '', substitutions: [],
      progression: {
        suggestedKg: 80, targetReps: 8, reason: 'Hold load', lastE1rmKg: null,
        trendE1rmKg: null, stepKg: 2.5, mode: 'preservation'
      }
    };
    const summary = getProgressionSummary(makeSession({ exercises: [exercise] }));
    expect(summary?.mode).toBe('preservation');
    expect(summary?.reason).toContain('Stored workout suggestions');
  });

  it('explains both the frozen Nutrition evidence and stored suggestion when the mode is available', () => {
    const exercise: SessionExercise = {
      id: 'ex-1', exerciseId: 'bench', name: 'Bench Press', position: 0, note: '',
      prescription: [], sets: [], sequenceGroup: '', substitutions: [],
      progression: {
        suggestedKg: 80, targetReps: 8, reason: 'Hold reps until recovery improves', lastE1rmKg: null,
        trendE1rmKg: null, stepKg: 2.5, mode: 'preservation'
      }
    };
    const summary = getProgressionSummary(makeSession({
      exercises: [exercise], nutritionContext: makeNutrition({ effectiveGoal: 'lose', targetRatePercent: 0.9 })
    }));

    expect(summary?.reason).toContain('recorded rate of 0.90% per week');
    expect(summary?.reason).toContain('Hold reps until recovery improves');
    expect(summary?.reason).toContain('Stored workout suggestions use preservation progression');
  });

  it('retains a stored historical mode while labeling its Nutrition snapshot stale', () => {
    const exercise: SessionExercise = {
      id: 'ex-1', exerciseId: 'bench', name: 'Bench Press', position: 0, note: '',
      prescription: [], sets: [], sequenceGroup: '', substitutions: [],
      progression: {
        suggestedKg: 80, targetReps: 8, reason: 'Hold reps', lastE1rmKg: null,
        trendE1rmKg: null, stepKg: 2.5, mode: 'preservation'
      }
    };
    const summary = getProgressionSummary(makeSession({
      exercises: [exercise],
      nutritionContext: makeNutrition({ effectiveGoal: 'lose', targetRatePercent: 0.9, retrievedAt: '2026-03-20T10:00:00Z' })
    }));

    expect(summary?.mode).toBe('preservation');
    expect(summary?.goal).toBeNull();
    expect(summary?.nutritionStatus).toBe('stale');
    expect(summary?.reason).toContain('stored session decision is retained');
  });

  it('does not show a stale frozen loss snapshot as preservation mode', () => {
    const session = makeSession({
      nutritionContext: makeNutrition({
        effectiveGoal: 'lose', targetRatePercent: 0.9,
        retrievedAt: '2026-03-20T10:00:00Z'
      })
    });
    const summary = getProgressionSummary(session);
    expect(summary?.mode).toBe('normal');
    expect(summary?.goal).toBeNull();
    expect(summary?.nutritionStatus).toBe('stale');
    expect(summary?.reason).toContain('standard progression applied');
  });

  it('marks fresh cached Nutrition distinctly while using its frozen mode', () => {
    const summary = getProgressionSummary(makeSession({
      nutritionContext: makeNutrition({ effectiveGoal: 'lose', targetRatePercent: 0.4, cached: true })
    }));
    expect(summary?.nutritionStatus).toBe('cached');
    expect(summary?.mode).toBe('conservative');
    expect(summary?.reason).toContain('saved Nutrition snapshot');
  });
});
