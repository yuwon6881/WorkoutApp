import { describe, expect, it } from 'vitest';
import { muscleThumbTarget } from './muscleThumbTarget';

describe('muscleThumbTarget', () => {
  it('uses a muscle that is already one body-map plate', () => {
    expect(muscleThumbTarget({ name: 'Back Squat', muscle: 'Quads', secondaryMuscles: ['Glutes'] })).toBe('Quads');
  });

  it('picks the member of a catalog group that the movement trains', () => {
    expect(muscleThumbTarget({ name: 'Standing Calf Raise', muscle: 'Traps, calves, and hips' })).toBe('Calves');
    expect(muscleThumbTarget({ name: 'Barbell Shrug', muscle: 'Traps, calves, and hips' })).toBe('Traps');
    expect(muscleThumbTarget({ name: 'Head Harness Neck Curl', muscle: 'Adductors and neck' })).toBe('Neck');
    expect(muscleThumbTarget({ name: 'DB Curl', muscle: 'Biceps and forearms' })).toBe('Biceps');
    expect(muscleThumbTarget({ name: 'Wrist Curl', muscle: 'Biceps and forearms' })).toBe('Forearms');
    expect(muscleThumbTarget({ name: 'Romanian Deadlift', muscle: 'Posterior chain' })).toBe('Hamstrings');
    expect(muscleThumbTarget({ name: 'Barbell Hip Thrust', muscle: 'Posterior chain' })).toBe('Glutes');
  });

  it('falls back to a secondary plate, and to none for an unmapped muscle', () => {
    expect(muscleThumbTarget({ name: 'Farmer Carry', muscle: 'Full body', secondaryMuscles: ['Grip', 'Traps'] })).toBe('Traps');
    expect(muscleThumbTarget({ name: 'Burpee', muscle: 'Full body' })).toBeNull();
  });
});
