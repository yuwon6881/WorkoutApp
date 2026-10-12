import { expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoutineCard } from './RoutineCard';
import { mockTemplate } from './nextWorkoutHeroTestFixtures';

it('previews working sets, handles empty sets, and prevents another workout start', () => {
  const template = mockTemplate();
  const exercise = template.exercises[0];
  const working = { ...exercise.sets[0], repMin: 8, repMax: 10, warmup: false };
  template.exercises = [{ ...exercise, sets: [{ ...working, warmup: true, repMin: 20, repMax: 20 }, working] },
    { ...exercise, id: 'empty', sets: [] }];
  const html = renderToStaticMarkup(React.createElement(RoutineCard, {
    template, exercises: [], onEdit: () => {}, onStart: () => {}, hasActiveWorkout: true, activeTemplateId: 'another'
  }));
  expect(html).toContain('1 × 8–10');
  expect(html).toContain('0 × —');
  expect(html).toMatch(/disabled=""[^>]*>Start workout/);
});
