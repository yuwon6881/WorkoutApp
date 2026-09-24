import { describe, expect, it } from 'vitest';
import type { Exercise, SetPrescription, TemplateExercise } from '../types';
import { getPlannedMuscleCredits } from './programMuscles';

function catalogExercise(id: string, muscle: string, secondaryMuscles: string[] = []): Exercise {
  return {
    id,
    slug: id,
    name: id,
    muscle,
    secondaryMuscles,
    equipment: 'Barbell',
    cue: '',
    aliases: [],
    loadStepKg: 2.5
  };
}

function set(warmup = false): SetPrescription {
  return {
    repMin: 8,
    repMax: 10,
    targetRpe: null,
    restSeconds: null,
    tempo: null,
    loadText: null,
    notes: null,
    repsText: null,
    restText: null,
    rir: null,
    warmup,
    repsSource: 'extracted',
    rpeSource: 'extracted',
    restSource: 'extracted'
  };
}

function workoutExercise(exerciseId: string | null, name: string, sets: SetPrescription[]): TemplateExercise {
  return {
    id: `${name}-slot`,
    exerciseId,
    sourceName: name,
    name,
    note: '',
    position: 0,
    sets,
    sequenceGroup: '',
    substitutions: []
  };
}

describe('getPlannedMuscleCredits', () => {
  it('ranks planned working-set credits and breaks ties by muscle name', () => {
    const result = getPlannedMuscleCredits([
      workoutExercise('bench', 'Barbell Bench Press', [set(), set(), set(true)]),
      workoutExercise('squat', 'Leg Extension', [set(), set()])
    ], [
      catalogExercise('bench', 'Chest', ['Triceps']),
      catalogExercise('squat', 'Quads')
    ]);

    expect(result).toEqual({
      muscles: [
        { muscle: 'Chest', sets: 2 },
        { muscle: 'Quads', sets: 2 },
        { muscle: 'Shoulders', sets: 1 },
        { muscle: 'Triceps', sets: 1 }
      ],
      unattributedExercises: 0
    });
  });

  it('credits catalog and movement secondaries at half weight without duplicating primary work', () => {
    const result = getPlannedMuscleCredits([
      workoutExercise('press', 'Barbell Bench Press', [set(), set(), set()])
    ], [catalogExercise('press', 'Chest', ['Chest', 'Triceps'])]);

    expect(result.muscles).toEqual([
      { muscle: 'Chest', sets: 3 },
      { muscle: 'Shoulders', sets: 1.5 },
      { muscle: 'Triceps', sets: 1.5 }
    ]);
  });

  it('matches compound-bucket and movement credits from the server attribution rules', () => {
    const result = getPlannedMuscleCredits([
      workoutExercise('posterior', 'Romanian Deadlift', [set()]),
      workoutExercise(null, 'Mystery machine exercise', [set()]),
      workoutExercise(null, 'Mystery curl', [set(true)])
    ], [catalogExercise('posterior', 'Posterior chain')]);

    expect(result.muscles).toEqual([
      { muscle: 'Glutes', sets: 1 },
      { muscle: 'Hamstrings', sets: 1 },
      { muscle: 'Back', sets: 0.5 }
    ]);
    expect(result.unattributedExercises).toBe(1);
  });

  it('keeps unmatched names out of the map and does not count warm-up-only prescriptions', () => {
    const result = getPlannedMuscleCredits([
      workoutExercise(null, 'Unmapped unfamiliar movement', [set(), set(true)]),
      workoutExercise('known', 'Known movement', [set(true)])
    ], [catalogExercise('known', 'Chest')]);

    expect(result).toEqual({ muscles: [], unattributedExercises: 1 });
  });

  it('recalculates when a program slot is swapped to another catalog exercise', () => {
    const slot = workoutExercise('chest', 'Press', [set(), set()]);
    const catalog = [catalogExercise('chest', 'Chest'), catalogExercise('legs', 'Quads')];

    expect(getPlannedMuscleCredits([slot], catalog).muscles).toEqual([{ muscle: 'Chest', sets: 2 }]);
    expect(getPlannedMuscleCredits([{ ...slot, exerciseId: 'legs', name: 'Leg Extension' }], catalog).muscles)
      .toEqual([{ muscle: 'Quads', sets: 2 }]);
  });
});
