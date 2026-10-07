import { describe, expect, it } from 'vitest';
import type { Exercise, LoggedSet } from '../types';
import { getSessionMuscleCredits } from './sessionMuscles';

function catalogExercise(id: string, muscle: string, secondaryMuscles: string[] = []): Exercise {
  return { id, slug: id, name: id, muscle, secondaryMuscles, equipment: 'Barbell', aliases: [], loadStepKg: 2.5 };
}

function logged(done: boolean, warmup = false): LoggedSet {
  return { id: crypto.randomUUID(), position: 0, weightKg: 60, reps: 8, rpe: null, done, warmup };
}

describe('getSessionMuscleCredits', () => {
  it('credits only logged working sets, primary in full and secondary at half weight', () => {
    const catalog = [catalogExercise('bench', 'Chest', ['Triceps'])];
    const summary = getSessionMuscleCredits([{
      exerciseId: 'bench',
      name: 'Bench Press',
      sets: [logged(true, true), logged(true), logged(true), logged(false)]
    }], catalog);

    // Bench press also earns its movement's shoulder credit; the warm-up and the unlogged set earn nothing.
    expect(summary.muscles).toEqual([
      { muscle: 'Chest', sets: 2 },
      { muscle: 'Shoulders', sets: 1 },
      { muscle: 'Triceps', sets: 1 }
    ]);
    expect(summary.unattributedExercises).toBe(0);
  });

  it('leaves an exercise with nothing logged out of the map and reports unknown movements', () => {
    const summary = getSessionMuscleCredits([
      { exerciseId: null, name: 'Mystery machine', sets: [logged(true)] },
      { exerciseId: null, name: 'Leg curl', sets: [logged(false)] }
    ], []);

    expect(summary.muscles).toEqual([]);
    expect(summary.unattributedExercises).toBe(1);
  });
});
