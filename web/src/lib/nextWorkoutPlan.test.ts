import { describe, expect, it } from 'vitest';
import type { Exercise, Template } from '../types';
import type { ExerciseLastPerformed } from './lastPerformed';
import { nextWorkoutPlan } from './nextWorkoutPlan';

const set = { reps: 8, repsMax: 10, rpe: null, rir: 2, warmup: false, restSeconds: 120 };

function exercise(id: string, name: string, position: number, exerciseId: string | null) {
  return { id, exerciseId, sourceName: name, name, note: '', position, sets: [set, set, set], sequenceGroup: '', substitutions: [] };
}

const template = {
  id: 't', programId: null, name: 'Lower A', focus: '', note: '', week: 1, position: 0, revision: 1,
  block: '', phase: '', phaseWeek: 1, isRestDay: false,
  // Stored out of order: the plan reads exercises by position.
  exercises: [
    exercise('c', 'Leg press', 2, 'press'),
    exercise('a', 'Back squat', 0, 'squat'),
    exercise('d', 'Calf raise', 3, null),
    exercise('b', 'Romanian deadlift', 1, 'rdl')
  ]
} as unknown as Template;

const last = (exerciseId: string, weightKg: number | null, reps: number | null): ExerciseLastPerformed =>
  ({ exerciseId, finishedAt: '2026-10-27T12:00:00Z', weightKg, reps, durationSeconds: null });

describe('nextWorkoutPlan', () => {
  it('lists the opening exercises in plan order with each last top set, and counts the rest', () => {
    const history = new Map([['squat', last('squat', 100, 6)], ['rdl', last('rdl', 20, 8)]]);
    const catalog = [{ id: 'rdl', weightBasis: 'per_side' }] as unknown as Exercise[];
    const plan = nextWorkoutPlan(template, history, catalog, 'kg', 90);

    expect(plan.rows).toEqual([
      { key: 'a', name: 'Back squat', last: '100 kg × 6' },
      { key: 'b', name: 'Romanian deadlift', last: '20 kg/side × 8' },
      { key: 'c', name: 'Leg press', last: null }
    ]);
    expect(plan.more).toBe(1);
  });

  it('estimates the length at the planned rests', () => {
    // Four exercises of three sets: 12 × 40 s work, 8 × 120 s rests, 3 × 90 s changeovers ≈ 28 min.
    expect(nextWorkoutPlan(template, new Map(), [], 'kg', 90).minutes).toBe(30);
  });

  it('never invents a last set for a movement with no history or nothing logged', () => {
    const plan = nextWorkoutPlan(template, new Map([['squat', last('squat', null, null)]]), [], 'kg', 90);
    expect(plan.rows.map(row => row.last)).toEqual([null, null, null]);
  });
});
