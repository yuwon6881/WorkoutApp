import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Session, SessionExercise } from '../types';
import { WorkoutActiveExercise } from './WorkoutActiveExercise';

const exercise: SessionExercise = {
  id: 'row', exerciseId: 'row-id', name: 'Barbell Row', position: 0, note: '',
  prescription: [], sets: [], sequenceGroup: '', substitutions: [], progression: null
};

function render(current: SessionExercise, onOpenExercise?: (id: string) => void) {
  const draft = { id: 'session', name: 'Pull', exercises: [current] } as unknown as Session;
  return renderToStaticMarkup(createElement(WorkoutActiveExercise, {
    exercise: current, index: 0, unit: 'kg', draft, exercises: [],
    change: () => undefined, editSet: () => undefined, toggle: () => undefined,
    onSwap: async () => undefined, onRemoveExercise: () => undefined, onOpenExercise
  }));
}

describe('WorkoutActiveExercise', () => {
  it('offers the library progress of a catalog exercise from the workout', () => {
    expect(render(exercise, () => undefined)).toContain('aria-label="Barbell Row progress and history"');
  });

  it('offers no progress for an exercise outside the library, or without a way to open it', () => {
    expect(render({ ...exercise, exerciseId: null }, () => undefined)).not.toContain('progress and history');
    expect(render(exercise)).not.toContain('progress and history');
  });
});
