import { describe, expect, it } from 'vitest';
import type { TemplateExercise } from '../types';
import type { ImportDraft } from '../types';
import { validateLoggedSet, validateProgramEditorDocument, validateTemplateDraft } from './validation';

const exercise = (): TemplateExercise => ({
  id: 'exercise-row', exerciseId: 'exercise', sourceName: 'Bench press', name: 'Bench press', note: '', position: 0,
  sets: [{ repMin: 8, repMax: 12, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsText: null, restText: null, rir: null, warmup: false, repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited' }],
  sequenceGroup: '', substitutions: []
});

describe('application-owned validation', () => {

  const programDraft = (): ImportDraft => ({ programName: 'Four day plan', workouts: Array.from({ length: 7 }, (_, index) => ({
    lineId: `day-${index}`, week: 1, weekId: 'week-1', blockId: 'block-1', name: index < 5 ? `Day ${index + 1}` : `Rest ${index - 4}`,
    focus: null, notes: null, exercises: index < 5 ? [{ lineId: `exercise-${index}`, sourceName: 'Bench press', exerciseId: null, notes: null,
      sets: [{ repMin: 8, repMax: 12, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsSource: 'userEdited',
        rpeSource: 'userEdited', restSource: 'userEdited', repsText: null, restText: null, rir: null, warmup: false }], sequenceGroup: '', substitutions: [] }] : [],
    block: 'Block 1', phase: null, phaseWeek: 1, isRestDay: index >= 5
  })) });

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

  it('accepts a seven-day custom week and rejects an eighth day', () => {
    const draft = programDraft();
    expect(validateProgramEditorDocument(draft)).toBeUndefined();
    const overflow = { ...draft, workouts: [...draft.workouts, { ...draft.workouts[6], lineId: 'day-8', weekId: 'week-1' }] };
    expect(validateProgramEditorDocument(overflow)).toBe('A week can contain at most 7 days.');
  });

  it('requires mapped exercises and distinct block names when creating a custom program', () => {
    const draft = programDraft();
    expect(validateProgramEditorDocument(draft, true)).toBe('Select a library exercise for Bench press.');
    const mapped = { ...draft, workouts: draft.workouts.map(day => ({
      ...day,
      exercises: day.exercises.map(item => ({ ...item, exerciseId: 'exercise' }))
    })) };
    expect(validateProgramEditorDocument(mapped, true)).toBeUndefined();
    const splitWeek = { ...mapped, workouts: mapped.workouts.map((day, index) => index === 0
      ? { ...day, blockId: 'block-2' }
      : day) };
    expect(validateProgramEditorDocument(splitWeek, true)).toBe('Every week must belong to one block and have one identity.');
    const duplicatedName = { ...mapped, workouts: mapped.workouts.map((day, index) => index < 5
      ? { ...day, week: 1, weekId: 'week-1' }
      : { ...day, week: 2, weekId: 'week-2', blockId: 'block-2' }) };
    expect(validateProgramEditorDocument(duplicatedName, true)).toBe('Give each block a different name.');
  });

  it('rejects all-rest programs and split identities within one week', () => {
    const draft = programDraft();
    expect(validateProgramEditorDocument({ ...draft, workouts: draft.workouts.map(day => ({ ...day, isRestDay: true, exercises: [] })) }))
      .toBe('A program needs at least one training day.');
    expect(validateProgramEditorDocument({ ...draft, workouts: draft.workouts.map((day, index) => index === 1 ? { ...day, blockId: 'another-block' } : day) }))
      .toBe('Every week must belong to one block and have one identity.');
  });
});
