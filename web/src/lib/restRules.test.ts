import { describe, expect, it } from 'vitest';
import type { SessionExercise, SetPrescription } from '../types';
import { exerciseRestSeconds, findNextStep, restAppliesAfter, restSecondsAfter, type WorkoutStep } from './restRules';

function makeExercise(id: string, name: string, sequenceGroup = '', setsCount = 3, options?: { warmupFirst?: boolean; dropsetLast?: boolean; myorepsLast?: boolean }): SessionExercise {
  const prescription: SetPrescription[] = Array.from({ length: setsCount }, (_, i) => {
    const isWarmup = Boolean(options?.warmupFirst && i === 0);
    let notes: string | null = null;
    if (options?.dropsetLast && i === setsCount - 1) notes = 'Dropset';
    if (options?.myorepsLast && i === setsCount - 1) notes = 'Myo-reps';
    return {
      repMin: 8,
      repMax: 10,
      targetRpe: isWarmup ? null : 8,
      restSeconds: 90,
      tempo: null,
      loadText: null,
      notes,
      repsText: null,
      restText: null,
      rir: null,
      warmup: isWarmup,
      repsSource: 'userEdited',
      rpeSource: 'userEdited',
      restSource: 'userEdited'
    };
  });

  return {
    id,
    exerciseId: id,
    name,
    position: 0,
    note: '',
    sequenceGroup,
    substitutions: [],
    progression: null,
    prescription,
    sets: prescription.map((p, i) => ({
      id: `${id}-set-${i}`,
      position: i,
      weightKg: 60,
      reps: 8,
      rpe: 8,
      done: false,
      warmup: p.warmup
    }))
  };
}

describe('restAppliesAfter', () => {
  it('rests after the last warm-up before a working set', () => {
    const ex = makeExercise('ex1', 'Bench Press', '', 2, { warmupFirst: true });
    expect(restAppliesAfter(
      { exercise: ex, setIndex: 0, set: ex.sets[0], prescription: ex.prescription[0] },
      { exercise: ex, setIndex: 1, set: ex.sets[1], prescription: ex.prescription[1] }
    )).toBe(true);
  });

  it('rests after myo-reps even when they finish the exercise', () => {
    const ex = makeExercise('ex1', 'Curl', '', 2, { myorepsLast: true });
    expect(restAppliesAfter({ exercise: ex, setIndex: 1, set: ex.sets[1], prescription: ex.prescription[1] }, null)).toBe(true);
  });

  it('rests after the final working set too', () => {
    const ex = makeExercise('ex1', 'Bench Press');
    const current: WorkoutStep = { exercise: ex, setIndex: 2, set: ex.sets[2], prescription: ex.prescription[2] };
    expect(restAppliesAfter(current, null)).toBe(true);
    expect(restAppliesAfter(current, undefined)).toBe(true);
  });

  it('returns true between normal working sets of the same exercise', () => {
    const ex = makeExercise('ex1', 'Bench Press');
    const current: WorkoutStep = { exercise: ex, setIndex: 0, set: ex.sets[0], prescription: ex.prescription[0] };
    const next: WorkoutStep = { exercise: ex, setIndex: 1, set: ex.sets[1], prescription: ex.prescription[1] };
    expect(restAppliesAfter(current, next)).toBe(true);
  });

  it('returns false when next step is a warmup set', () => {
    const ex = makeExercise('ex1', 'Bench Press', '', 3, { warmupFirst: true });
    const current: WorkoutStep = { exercise: ex, setIndex: 0, set: ex.sets[0], prescription: ex.prescription[0] };
    // If next is warmup:
    const warmupNext: WorkoutStep = {
      exercise: ex,
      setIndex: 0,
      set: ex.sets[0],
      prescription: { ...ex.prescription[0], warmup: true }
    };
    expect(restAppliesAfter(current, warmupNext)).toBe(false);
  });

  it('rests before a drop set', () => {
    const ex = makeExercise('ex1', 'Cable Row', '', 2, { dropsetLast: true });
    const current: WorkoutStep = { exercise: ex, setIndex: 0, set: ex.sets[0], prescription: ex.prescription[0] };
    const next: WorkoutStep = { exercise: ex, setIndex: 1, set: ex.sets[1], prescription: ex.prescription[1] };
    expect(restAppliesAfter(current, next)).toBe(true);
  });

  it('rests before myo-reps', () => {
    const ex = makeExercise('ex1', 'Bicep Curl', '', 2, { myorepsLast: true });
    const current: WorkoutStep = { exercise: ex, setIndex: 0, set: ex.sets[0], prescription: ex.prescription[0] };
    const next: WorkoutStep = { exercise: ex, setIndex: 1, set: ex.sets[1], prescription: ex.prescription[1] };
    expect(restAppliesAfter(current, next)).toBe(true);
  });

  it('returns false when transitioning from superset partner A to partner B', () => {
    const exA = { ...makeExercise('exA', 'Bench Press', 'A1'), position: 0 };
    const exB = { ...makeExercise('exB', 'Dumbbell Row', 'A2'), position: 1 };
    const current: WorkoutStep = { exercise: exA, setIndex: 0, set: exA.sets[0], prescription: exA.prescription[0] };
    const next: WorkoutStep = { exercise: exB, setIndex: 0, set: exB.sets[0], prescription: exB.prescription[0] };
    expect(restAppliesAfter(current, next)).toBe(false);
  });

  it('returns true when transitioning from superset partner B back to partner A for the next round', () => {
    const exA = { ...makeExercise('exA', 'Bench Press', 'A1'), position: 0 };
    const exB = { ...makeExercise('exB', 'Dumbbell Row', 'A2'), position: 1 };
    const current: WorkoutStep = { exercise: exB, setIndex: 0, set: exB.sets[0], prescription: exB.prescription[0] };
    const next: WorkoutStep = { exercise: exA, setIndex: 1, set: exA.sets[1], prescription: exA.prescription[1] };
    expect(restAppliesAfter(current, next)).toBe(true);
  });

  it('returns true when transitioning from superset partner B to an unpaired exercise C', () => {
    const exB = { ...makeExercise('exB', 'Dumbbell Row', 'A2'), position: 1 };
    const exC = { ...makeExercise('exC', 'Lateral Raise', ''), position: 2 };
    const current: WorkoutStep = { exercise: exB, setIndex: 2, set: exB.sets[2], prescription: exB.prescription[2] };
    const next: WorkoutStep = { exercise: exC, setIndex: 0, set: exC.sets[0], prescription: exC.prescription[0] };
    expect(restAppliesAfter(current, next)).toBe(true);
  });
});

describe('findNextStep', () => {
  it('returns to an unfinished partner after sets were removed or logged out of order', () => {
    const a = makeExercise('a', 'Curl', 'A1', 1);
    const b = makeExercise('b', 'Pushdown', 'A2', 2);
    const step = findNextStep([a, b], 1, 1);
    expect(step?.exercise.id).toBe('a');
    expect(step?.setIndex).toBe(0);
  });

  it('finds next uncompleted set in same exercise for straight sets', () => {
    const ex = makeExercise('ex1', 'Bench Press', '', 3);
    const step = findNextStep([ex], 0, 0);
    expect(step).not.toBeNull();
    expect(step?.exercise.id).toBe('ex1');
    expect(step?.setIndex).toBe(1);
  });

  it('finds first uncompleted set in next exercise when current exercise is finished', () => {
    const ex1 = makeExercise('ex1', 'Bench Press', '', 2);
    ex1.sets[1].done = true;
    const ex2 = makeExercise('ex2', 'Squat', '', 2);
    const step = findNextStep([ex1, ex2], 0, 0);
    expect(step).not.toBeNull();
    expect(step?.exercise.id).toBe('ex2');
    expect(step?.setIndex).toBe(0);
  });

  it('rotates to superset partner in the same round', () => {
    const exA = { ...makeExercise('exA', 'Bench Press', 'A1', 2), position: 0 };
    const exB = { ...makeExercise('exB', 'Dumbbell Row', 'A2', 2), position: 1 };
    const step = findNextStep([exA, exB], 0, 0);
    expect(step).not.toBeNull();
    expect(step?.exercise.id).toBe('exB');
    expect(step?.setIndex).toBe(0);
  });

  it('cycles from last superset partner to first partner for next round', () => {
    const exA = { ...makeExercise('exA', 'Bench Press', 'A1', 2), position: 0 };
    const exB = { ...makeExercise('exB', 'Dumbbell Row', 'A2', 2), position: 1 };
    const step = findNextStep([exA, exB], 1, 0);
    expect(step).not.toBeNull();
    expect(step?.exercise.id).toBe('exA');
    expect(step?.setIndex).toBe(1);
  });

  it('returns null when all sets across all exercises are complete', () => {
    const ex = makeExercise('ex1', 'Bench Press', '', 2);
    ex.sets[1].done = true;
    const step = findNextStep([ex], 0, 1);
    expect(step).toBeNull();
  });
});

describe('rest length', () => {
  // A template built with a per-set rest and no exercise-level rest timer once started a
  // 1:30 rest after a set its plan gave 150 seconds.
  it('uses the rest the plan gives the logged set when the exercise has no rest timer', () => {
    const ex = makeExercise('bench', 'Bench');
    ex.prescription = ex.prescription.map(p => ({ ...p, restSeconds: 150 }));
    expect(restSecondsAfter(ex, 1, 90)).toBe(150);
  });

  it('lets the exercise rest timer win over the set prescription', () => {
    const ex = { ...makeExercise('bench', 'Bench'), restSeconds: 120 };
    expect(restSecondsAfter(ex, 1, 90)).toBe(120);
  });

  it('falls back to the account default when neither says', () => {
    const ex = makeExercise('bench', 'Bench');
    ex.prescription = ex.prescription.map(p => ({ ...p, restSeconds: null }));
    expect(restSecondsAfter(ex, 0, 75)).toBe(75);
    expect(restSecondsAfter(ex, 9, 75)).toBe(75);
  });

  it('rests after a warm-up for the time its own prescription gives', () => {
    const ex = makeExercise('bench', 'Bench', '', 3, { warmupFirst: true });
    ex.prescription[0] = { ...ex.prescription[0], restSeconds: 60 };
    ex.prescription[1] = { ...ex.prescription[1], restSeconds: 180 };
    expect(restSecondsAfter(ex, 0, 90)).toBe(60);
    expect(restSecondsAfter(ex, 1, 90)).toBe(180);
  });

  it('shows the rest of the first working set rather than a leading warm-up', () => {
    const ex = makeExercise('bench', 'Bench', '', 3, { warmupFirst: true });
    ex.prescription[0] = { ...ex.prescription[0], restSeconds: 60 };
    ex.prescription[1] = { ...ex.prescription[1], restSeconds: 180 };
    expect(exerciseRestSeconds(ex, 90)).toBe(180);
    expect(exerciseRestSeconds({ ...ex, restSeconds: 45 }, 90)).toBe(45);
    expect(exerciseRestSeconds({ ...ex, prescription: [] }, 90)).toBe(90);
  });
});
