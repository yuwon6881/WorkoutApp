import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MuscleBreakdownGroup } from './MuscleBreakdownGroup';
import type { MuscleBalanceRow } from '../types';

describe('MuscleBreakdownGroup', () => {
  const sampleMuscle: MuscleBalanceRow = {
    muscle: 'Chest',
    sets: 5.5,
    primarySets: 4,
    secondarySets: 1.5,
    sessions: 2,
    lastTrainedDate: '2026-11-20',
    contributions: [
      { exerciseId: 'bench-press', name: 'Barbell Bench Press', sets: 3 },
      { exerciseId: 'incline-dumbbell-press', name: 'Incline Dumbbell Press', sets: 1.5 },
      { exerciseId: 'push-up', name: 'Push-up', sets: 1 },
      { exerciseId: null, name: 'Dip (Machine)', sets: 2 }
    ]
  };

  it('renders contributing lifts with "sets" / "set" and without "credits" wording', () => {
    const markup = renderToStaticMarkup(createElement(MuscleBreakdownGroup, {
      title: 'Upper body',
      muscles: [sampleMuscle],
      peak: 5.5,
      activeMuscle: 'Chest',
      onSelect: vi.fn(),
      onHover: vi.fn(),
      onExercise: vi.fn()
    }));

    // Must not contain any "credit" wording in rendered UI
    expect(markup.toLowerCase()).not.toContain('credit');

    // Plural and singular set formatting for contributing lifts
    expect(markup).toContain('3 sets');
    expect(markup).toContain('1.5 sets');
    expect(markup).toContain('1 set');
    expect(markup).toContain('2 sets');

    // Lift names should be present
    expect(markup).toContain('Barbell Bench Press');
    expect(markup).toContain('Incline Dumbbell Press');
    expect(markup).toContain('Push-up');
    expect(markup).toContain('Dip (Machine)');
  });
});
