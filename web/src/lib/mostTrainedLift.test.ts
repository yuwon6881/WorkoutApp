import { describe, expect, it } from 'vitest';
import type { ProgressExercise } from '../types';
import { mostTrainedLift } from './mostTrainedLift';

const lift = (over: Partial<ProgressExercise>): ProgressExercise => ({
  exerciseId: 'id', exercise: 'Squat', sessions: 1, heaviestKg: null, heaviestReps: null, volumeKg: null,
  estimatedMaxKg: 100, lastEstimatedMaxKg: null, externalLoadPrKg: null, addedLoadPrKg: null,
  assistanceReductionPrKg: null, systemLoadPrKg: null, repPr: null, estimatedSystemLoadMaxKg: null,
  relativeStrength: null, bodyweightRepRecord: null, ...over
});

describe('mostTrainedLift', () => {
  it('is null without any history', () => {
    expect(mostTrainedLift(undefined)).toBeNull();
    expect(mostTrainedLift([])).toBeNull();
  });

  it('picks the lift with the most sessions', () => {
    expect(mostTrainedLift([lift({ exercise: 'Squat', sessions: 4 }), lift({ exercise: 'Bench press', sessions: 9 })])).toBe('Bench press');
  });

  it('skips exercises with no strength estimate or no catalogue id', () => {
    expect(mostTrainedLift([
      lift({ exercise: 'Plank', sessions: 20, estimatedMaxKg: null }),
      lift({ exercise: 'Custom', sessions: 15, exerciseId: null }),
      lift({ exercise: 'Deadlift', sessions: 2 })
    ])).toBe('Deadlift');
  });

  it('breaks ties by volume, then name', () => {
    expect(mostTrainedLift([lift({ exercise: 'Row', sessions: 5, volumeKg: 900 }), lift({ exercise: 'Press', sessions: 5, volumeKg: 1200 })])).toBe('Press');
    expect(mostTrainedLift([lift({ exercise: 'Row', sessions: 5 }), lift({ exercise: 'Press', sessions: 5 })])).toBe('Press');
  });
});
