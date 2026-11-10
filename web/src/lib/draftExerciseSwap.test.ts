import { describe, expect, it } from 'vitest';
import type { DraftExercise, Exercise } from '../types';
import { displayExerciseName, selectDraftExercise } from './draftExerciseSwap';

const library = [
  { id: 'glute', name: 'Glute Ham Raise', aliases: [] },
  { id: 'reverse', name: 'Reverse Hyper', aliases: ['reverse hyperextension'] },
  { id: 'nordic', name: 'Nordic Ham Curl', aliases: [] }
] as Exercise[];
const draft = { exerciseId: 'glute', sourceName: 'GLUTE HAM RAISE', substitutions: ['reverse hyper', 'reverse hyperextension', 'nordic ham curl'], demoLinks: [] } as unknown as DraftExercise;

describe('draft exercise selection', () => {
  it('updates the name and exchanges deduplicated alternatives on a swap', () => {
    const next = selectDraftExercise(draft, library[1], library, true);
    expect(next.sourceName).toBe('Reverse Hyper');
    expect(next.exerciseId).toBe('reverse');
    expect(next.substitutions).toEqual(['Glute Ham Raise', 'nordic ham curl']);
    expect(displayExerciseName(next.substitutions[1], library)).toBe('Nordic Ham Curl');
  });
  it('preserves the printed name when initially mapping an import', () => {
    expect(selectDraftExercise({ ...draft, exerciseId: null }, library[0], library, true).sourceName).toBe('GLUTE HAM RAISE');
    expect(displayExerciseName('unknown movement', library)).toBe('Unknown movement');
  });
});
