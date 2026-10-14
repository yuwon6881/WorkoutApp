import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProgramSummary } from '../types';
import { ProgramWeekChecklist } from './ProgramWeekChecklist';

const program: ProgramSummary = {
  id: 'p1', name: 'Block', weeks: 1, active: true, revision: 1, sourceImportId: null, completedTemplateIds: [], nextTemplateId: 'b',
  lifecycleStatus: 'active',
  days: ['a', 'b', 'c'].map((id, position) => ({
    id, name: `Day ${id}`, focus: '', block: 'Block 1', phase: '', week: 1, phaseWeek: 1, position, isRestDay: false, exerciseCount: 1
  })),
  progress: {
    runId: 'r1', currentWeek: 1, currentAttempt: 1, passedDays: 1, totalDays: 3,
    days: [
      { templateId: 'a', status: 'completed', isRestDay: false, position: 0 },
      { templateId: 'b', status: 'pending', isRestDay: false, position: 1 },
      { templateId: 'c', status: 'pending', isRestDay: false, position: 2 }
    ]
  }
};

function render(hasActiveWorkout: boolean, activeTemplateId: string | null) {
  return renderToStaticMarkup(createElement(ProgramWeekChecklist, {
    program, exercises: [], onStart: () => {}, onChanged: async () => {}, hasActiveWorkout, activeTemplateId
  }));
}

function row(markup: string, name: string) {
  const start = markup.indexOf(`aria-label="View ${name}"`);
  const next = markup.indexOf('aria-label="View ', start + 1);
  return markup.slice(markup.lastIndexOf('<div', start), next < 0 ? undefined : markup.lastIndexOf('<div', next));
}

describe('ProgramWeekChecklist in-progress state', () => {
  it('marks the first pending day Next while nothing is running', () => {
    const markup = render(false, null);
    expect(row(markup, 'Day b')).toContain('>Next<');
    expect(row(markup, 'Day b')).not.toContain('In progress');
    expect(row(markup, 'Day c')).not.toContain('>Next<');
  });

  it('marks the running day In progress and moves Next to the following day', () => {
    const markup = render(true, 'b');
    const running = row(markup, 'Day b');
    expect(running).toContain('>In progress<');
    expect(running).toContain('in-progress');
    expect(running).not.toContain('>Next<');
    expect(running).toContain('aria-description="Workout in progress"');
    expect(row(markup, 'Day c')).toContain('>Next<');
  });

  it('keeps an earlier pending day Next while a later day is running', () => {
    const markup = render(true, 'c');
    expect(row(markup, 'Day c')).toContain('>In progress<');
    expect(row(markup, 'Day b')).toContain('>Next<');
  });

  it('shows no In progress badge for a completed day or an unrelated workout', () => {
    expect(render(true, 'a')).not.toContain('In progress');
    expect(render(true, 'other')).not.toContain('In progress');
  });
});
