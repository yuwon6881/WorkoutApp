import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Exercise, ProgramSummary, Template } from '../types';
import { ActiveProgramCard } from './ActiveProgramCard';
import { ActiveTemplateCard } from './ActiveTemplateCard';
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
      onEdit: () => {},
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
      onEdit: () => {},
      onDelete: () => {},
      dragProps: {},
      dragging: false
    }));

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="Expand Hypertrophy Block"');
  });
});

describe('ActiveTemplateCard in-progress state', () => {
  const template = {
    id: 't1', programId: null, name: 'Quick push', focus: '', note: '', week: 1, position: 0, revision: 1, active: true, activeCompletedAt: null,
    exercises: [{ id: 'e1', name: 'Bench press', sets: [{ warmup: false }] }]
  } as unknown as Template;
  const render = (activeTemplateId: string | null) => renderToStaticMarkup(createElement(ActiveTemplateCard, {
    template, onStart: () => {}, onEdit: () => {}, hasActiveWorkout: activeTemplateId !== null, activeTemplateId,
    actions: { busy: false, onMoveToLibrary: () => {}, onRestart: () => {}, onDelete: () => {} }, dragProps: {}, moving: false
  }));

  it('badges the open workout and offers Continue', () => {
    const markup = render('t1');
    expect(markup).toContain('In progress');
    expect(markup).toContain('template-slot-day in-progress');
    expect(markup).toContain('aria-label="Continue Quick push"');
  });

  it('shows no badge when no workout, or another workout, is open', () => {
    expect(render(null)).not.toContain('In progress');
    expect(render('other')).not.toContain('In progress');
  });
});
