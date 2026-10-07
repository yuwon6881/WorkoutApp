import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Exercise, ProgramSummary } from '../types';
import { ActiveProgramCard } from './ActiveProgramCard';
import { LibraryProgramCard } from './LibraryProgramCard';

const sampleProgram: ProgramSummary = {
  id: 'prog-1',
  name: 'Hypertrophy Block',
  weeks: 4,
  active: true,
  revision: 1,
  sourceImportId: null,
  completedTemplateIds: [],
  nextTemplateId: 'd1',
  lifecycleStatus: 'active',
  days: [
    { id: 'd1', name: 'Upper A', focus: 'Chest/Back', block: 'Block 1', phase: 'Hypertrophy', week: 1, phaseWeek: 1, position: 0, isRestDay: false, exerciseCount: 2 }
  ],
  progress: { runId: 'r1', currentWeek: 1, currentAttempt: 1, passedDays: 0, totalDays: 1, days: [] }
};

const sampleExercises: Exercise[] = [
  { id: 'ex-bench', slug: 'bench', name: 'Barbell bench press', muscle: 'Chest', equipment: 'Barbell', aliases: [], loadStepKg: 2.5, category: 'Free Weights' }
];

describe('WorkoutSlotCards expand/collapse states', () => {
  it('renders ActiveProgramCard expanded by default', () => {
    const markup = renderToStaticMarkup(createElement(ActiveProgramCard, {
      program: sampleProgram,
      exercises: sampleExercises,
      onStart: () => {},
      onChanged: async () => {},
      hasActiveWorkout: false,
      actions: { busy: false, onMoveToLibrary: () => {}, onRestart: () => {}, onDelete: () => {} },
      dragProps: {},
      moving: false,
      dragging: false
    }));

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="Collapse Hypertrophy Block"');
  });

  it('renders LibraryProgramCard collapsed by default', () => {
    const markup = renderToStaticMarkup(createElement(LibraryProgramCard, {
      program: { ...sampleProgram, active: false },
      exercises: sampleExercises,
      busy: false,
      onActivate: () => {},
      onDelete: () => {},
      dragProps: {},
      dragging: false
    }));

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="Expand Hypertrophy Block"');
  });
});
