import { describe, expect, it } from 'vitest';
import type { DraftExercise, DraftSet } from '../types';
import { estimateWorkoutMinutes } from './workoutEstimate';

const set = (restSeconds: number | null = null): DraftSet => ({
  repMin: 8, repMax: 10, targetRpe: null, restSeconds, tempo: null, loadText: null, notes: null,
  repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted', repsText: null, restText: null, rir: null, warmup: false
});
const exercise = (sets: DraftSet[], restSeconds?: number): DraftExercise => ({
  lineId: Math.random().toString(), sourceName: 'Lift', exerciseId: null, notes: null, sets, sequenceGroup: '', substitutions: [], restSeconds
});

describe('estimateWorkoutMinutes', () => {
  it('adds work, rests between sets and one move between exercises, rounded to five minutes', () => {
    // 6 sets × 40 s, 2 × 2 rests of 120 s, one 90 s move: 240 + 480 + 90 = 810 s ≈ 13.5 min → 15.
    expect(estimateWorkoutMinutes([exercise([set(), set(), set()], 120), exercise([set(), set(), set()], 120)], 90)).toBe(15);
  });

  it('prefers a set rest over the exercise rest over the default, and is null for an empty day', () => {
    expect(estimateWorkoutMinutes([exercise([set(600), set()], 60)], 90)).toBe(10);
    expect(estimateWorkoutMinutes([], 90)).toBeNull();
  });
});
