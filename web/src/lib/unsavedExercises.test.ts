import { describe, expect, it } from 'vitest';
import type { DraftExercise } from '../types';
import { UnsavedExercises } from './unsavedExercises';

const held = { base: 'saved', draft: {} as DraftExercise };

describe('UnsavedExercises', () => {
  it('announces only when the number of exercises holding edits changes', () => {
    const counts: number[] = [];
    const unsaved = new UnsavedExercises(count => counts.push(count));

    unsaved.set('a', held);
    unsaved.set('a', { ...held, base: 'typed more' });
    unsaved.set('b', held);
    unsaved.delete('missing');
    unsaved.delete('a');
    unsaved.clear();
    unsaved.clear();

    expect(counts).toEqual([1, 2, 1, 0]);
  });

  it('still behaves as the map the editors read from', () => {
    const unsaved = new UnsavedExercises(() => {});
    unsaved.set('a', held);
    expect(unsaved.get('a')).toBe(held);
    expect(unsaved.size).toBe(1);
  });
});
