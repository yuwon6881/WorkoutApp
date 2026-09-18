import { describe, expect, it } from 'vitest';
import type { TemplateExercise } from '../types';
import { validateLoggedSet, validateTemplateDraft } from './validation';

const exercise = (): TemplateExercise => ({
  id: 'exercise-row', exerciseId: 'exercise', sourceName: 'Bench press', name: 'Bench press', note: '', position: 0,
  sets: [{ repMin: 8, repMax: 12, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsText: null, restText: null, rir: null, warmup: false, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }],
  sequenceGroup: '', substitutions: []
});

describe('application-owned validation', () => {

  it('validates program fields before a save is sent', () => {
    expect(validateTemplateDraft('', '', [])).toBe('Workout name is required.');
    expect(validateTemplateDraft('Upper body', '', [exercise()])).toBeUndefined();
    expect(validateTemplateDraft('Upper body', 'x'.repeat(121), [exercise()])).toBe('Focus must be 120 characters or fewer.');
    expect(validateTemplateDraft('Upper body', '', [{ ...exercise(), sets: [] }])).toBe('Each exercise needs at least one set.');
  });

  it('allows incomplete sets while rejecting invalid values and completed reps blanks', () => {
    expect(validateLoggedSet({ id: 'set', position: 0, weightKg: null, reps: null, rpe: null, done: false, warmup: false })).toBeUndefined();
    expect(validateLoggedSet({ id: 'set', position: 0, weightKg: 1001, reps: 8, rpe: 8, done: false, warmup: false })).toBe('Weight must be between 0 and 1,000 kg.');
    expect(validateLoggedSet({ id: 'set', position: 0, weightKg: null, reps: null, rpe: null, done: true, warmup: false })).toBe('A completed set needs its reps.');
  });
});
