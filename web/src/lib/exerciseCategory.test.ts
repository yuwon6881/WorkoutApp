import { describe, expect, it } from 'vitest';
import { getExerciseCategory, loadModelForEquipment } from './exerciseCategory';
import { customAsExercise, selectDraftExercise } from './draftExerciseSwap';
import { toKg } from './training';
import type { DraftExercise } from '../types';

describe('getExerciseCategory', () => {
  it('files a plate-loaded machine under Machine', () => {
    expect(getExerciseCategory({ equipment: 'Plate-Loaded Machine', loadModel: 'external' })).toBe('Machine');
    expect(getExerciseCategory({ equipment: 'Barbell', loadModel: 'external' })).toBe('Free Weights');
  });
});

describe('loadModelForEquipment', () => {
  it('implies full bodyweight for Bodyweight and takes it back when the equipment changes', () => {
    const implied = loadModelForEquipment('', 'Bodyweight', 'external');
    expect(implied).toBe('full_bodyweight');
    expect(loadModelForEquipment('Bodyweight', 'Barbell', implied)).toBe('external');
  });

  it('keeps a model the lifter chose for other equipment', () => {
    expect(loadModelForEquipment('Band', 'Barbell', 'full_bodyweight')).toBe('full_bodyweight');
    expect(loadModelForEquipment('Bodyweight', 'Band', 'reps_only')).toBe('reps_only');
    expect(loadModelForEquipment('', 'Bodyweight', 'reps_only')).toBe('reps_only');
  });
});

describe('customAsExercise', () => {
  it('links a draft row to an exercise the loaded library does not list yet', () => {
    const created = customAsExercise({
      id: 'new-id', name: 'Cable Y Raise', muscle: 'Shoulders', equipment: 'Cable', loadStepKg: 2.5,
      loadModel: 'external', movementPattern: '', archived: false, createdAt: '2026-11-11T00:00:00Z', weightBasis: 'per_side'
    });
    const row = { lineId: 'line', exerciseId: null, sourceName: 'Y raise', sets: [] } as unknown as DraftExercise;

    const linked = selectDraftExercise(row, created, [], true);

    expect(linked.exerciseId).toBe('new-id');
    expect(created.weightBasis).toBe('per_side');
  });
});

describe('toKg', () => {
  it('converts pounds to the same kilograms as a whole number of pound steps', () => {
    const fivePoundStepKg = 5 / 2.2046226218;
    expect(Math.abs(toKg(225, 'lb')! - 45 * fivePoundStepKg)).toBeLessThan(1e-9);
  });
});
