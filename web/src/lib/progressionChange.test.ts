import { describe, expect, it } from 'vitest';
import type { SetProgressionSuggestion } from '../types';
import { progressionChange } from './progressionChange';

const suggestion = (over: Partial<SetProgressionSuggestion>): SetProgressionSuggestion => ({
  suggestedLoadKg: 82.5, suggestedReps: 8, reason: 'Progress.', sourceSessionId: null, sourceDate: null,
  progressionMode: 'normal', nutritionContextRevision: null, isBodyweightAdjustment: false,
  suggestedSystemLoadKg: null, resistanceMode: 'external', previousLoadKg: 80, previousReps: 8, ...over
});

describe('progressionChange', () => {
  it('names a heavier load as a weight increase, even when the reps drop to rebuild', () => {
    expect(progressionChange(suggestion({ suggestedLoadKg: 82.5, previousLoadKg: 80 }))).toEqual({ kind: 'load-up', deltaKg: 2.5 });
    expect(progressionChange(suggestion({ suggestedLoadKg: 82.5, suggestedReps: 6, previousLoadKg: 80, previousReps: 10 })))
      .toEqual({ kind: 'load-up', deltaKg: 2.5 });
  });

  it('names more reps at the same load as a rep increase', () => {
    expect(progressionChange(suggestion({ suggestedLoadKg: 80, suggestedReps: 9, previousLoadKg: 80, previousReps: 8 })))
      .toEqual({ kind: 'reps-up', deltaReps: 1 });
  });

  it('compares reps alone for a movement without load', () => {
    expect(progressionChange(suggestion({ suggestedLoadKg: null, previousLoadKg: null, suggestedReps: 12, previousReps: 10 })))
      .toEqual({ kind: 'reps-up', deltaReps: 2 });
  });

  it('says repeat when nothing changes, and names a lighter load or fewer reps as such', () => {
    expect(progressionChange(suggestion({ suggestedLoadKg: 80, previousLoadKg: 80 }))).toEqual({ kind: 'repeat' });
    expect(progressionChange(suggestion({ suggestedLoadKg: 75, previousLoadKg: 80 }))).toEqual({ kind: 'load-down', deltaKg: 5 });
    expect(progressionChange(suggestion({ suggestedLoadKg: 80, previousLoadKg: 80, suggestedReps: 6, previousReps: 8 })))
      .toEqual({ kind: 'reps-down', deltaReps: 2 });
  });

  it('claims nothing without a previous exposure, including suggestions stored before it was recorded', () => {
    expect(progressionChange(null)).toBeNull();
    expect(progressionChange(suggestion({ previousReps: null, previousLoadKg: null }))).toBeNull();
    expect(progressionChange(suggestion({ previousReps: undefined, previousLoadKg: undefined }))).toBeNull();
  });

  it('ignores floating-point noise between equal loads', () => {
    expect(progressionChange(suggestion({ suggestedLoadKg: 80.0000001, previousLoadKg: 80 }))).toEqual({ kind: 'repeat' });
  });
});
