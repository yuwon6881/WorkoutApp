import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SessionExerciseList } from './SessionExerciseList';
import type { SessionExercise } from '../types';

describe('SessionExerciseList', () => {
  const sampleExercise: SessionExercise = {
    id: 'se-1',
    exerciseId: 'ex-squat',
    name: 'Back Squat',
    position: 0,
    note: 'Keep chest up',
    prescription: [],
    sets: [
      { id: 'set-1', position: 0, reps: 6, weightKg: 100, rir: '2', rpe: 8, warmup: false, done: true }
    ],
    sequenceGroup: '',
    substitutions: [],
    progression: null
  };

  it('renders interactive exercise card with role="button" and aria-label when onExercise is supplied', () => {
    const onExercise = vi.fn();
    const markup = renderToStaticMarkup(createElement(SessionExerciseList, {
      exercises: [sampleExercise],
      unit: 'kg',
      loading: false,
      onExercise
    }));

    expect(markup).toContain('session-exercise-action');
    expect(markup).toContain('role="button"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="View Back Squat details"');
    expect(markup).toContain('Back Squat');
    expect(markup).toContain('1 working set');
  });

  it('renders static exercise card without button role when onExercise is not supplied', () => {
    const markup = renderToStaticMarkup(createElement(SessionExerciseList, {
      exercises: [sampleExercise],
      unit: 'kg',
      loading: false
    }));

    expect(markup).not.toContain('session-exercise-action');
    expect(markup).not.toContain('role="button"');
    expect(markup).toContain('Back Squat');
  });
});
