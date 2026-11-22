import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { categoryTone } from '../lib/exerciseCategory';
import { ExerciseHistoryEmpty, ExerciseProgressEmpty } from './ExerciseEmptyState';

describe('exercise empty states', () => {
  it('names the exercise and what the first logged workout unlocks, without inventing figures', () => {
    const html = renderToStaticMarkup(createElement(ExerciseProgressEmpty, { exerciseName: 'Incline press' }));
    expect(html).toContain('Not logged yet');
    expect(html).toContain('Complete a workout with Incline press');
    for (const label of ['Progress chart', 'Personal records', 'Session history']) expect(html).toContain(label);
    // The sketch is decorative: hidden from assistive technology and carrying no numbers.
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/\d+\s?(kg|lb)/);
  });

  it('gives the History tab one short message', () => {
    const html = renderToStaticMarkup(createElement(ExerciseHistoryEmpty));
    expect(html).toContain('No sessions yet');
    expect(html).toContain('every set you logged');
  });

  it('colours only real exercise categories', () => {
    expect(categoryTone('Free Weights')).toBe('blue');
    expect(categoryTone('Machine')).toBe('teal');
    expect(categoryTone('Body Weight')).toBe('green');
    expect(categoryTone('Recently trained')).toBeUndefined();
  });
});
