import { describe, expect, it } from 'vitest';
import type { DraftExercise, Exercise } from '../types';
import { displayExerciseName, draftExerciseName, selectDraftExercise, writtenMovementKey } from './draftExerciseSwap';

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
    expect(draftExerciseName(draft, library)).toBe('Glute Ham Raise');
    expect(draftExerciseName({ ...draft, exerciseId: null }, library)).toBe('GLUTE HAM RAISE');
  });

  it('names a user-added placeholder row after the library exercise it is linked to', () => {
    const added = { ...draft, sourceName: 'New exercise', exerciseId: null };
    expect(selectDraftExercise(added, library[0], library, true).sourceName).toBe('Glute Ham Raise');
  });

  it('keys a placeholder row by its own line so two added rows never share a movement', () => {
    const a = { ...draft, lineId: 'a', sourceName: 'New exercise', movementKey: null };
    const b = { ...draft, lineId: 'b', sourceName: ' new  Exercise ', movementKey: null };
    expect(writtenMovementKey(a)).not.toBe(writtenMovementKey(b));
    expect(writtenMovementKey({ ...draft, lineId: 'a', movementKey: null })).toBe(writtenMovementKey({ ...draft, lineId: 'b', movementKey: null }));
  });
});
