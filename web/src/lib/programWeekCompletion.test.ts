import { describe, expect, it } from 'vitest';
import type { ProgramSummary } from '../types';
import { programWeekCompletion } from './programWeekCompletion';

function program(): ProgramSummary {
  return {
    id: 'program', name: 'Training cycle', active: true, weeks: 2, revision: 1,
    sourceImportId: null, days: [], completedTemplateIds: ['old-attempt'], nextTemplateId: null,
    progress: {
      runId: 'run', currentWeek: 2, currentAttempt: 2, passedDays: 3, totalDays: 5,
      days: [
        { templateId: 'a', status: 'completed', isRestDay: false, position: 0 },
        { templateId: 'b', status: 'completed', isRestDay: false, position: 1 },
        { templateId: 'c', status: 'skipped', isRestDay: false, position: 2 },
        { templateId: 'd', status: 'pending', isRestDay: false, position: 3 },
        { templateId: 'rest', status: 'rest_passed', isRestDay: true, position: 4 }
      ]
    }
  };
}

describe('program week completion', () => {
  it('counts completed workouts in the current attempt, excluding rest and skipped completion', () => {
    expect(programWeekCompletion(program())).toEqual({ week: 2, completed: 2, total: 4, ratio: 0.5 });
  });

  it('does not invent a weekly target without an active program', () => {
    expect(programWeekCompletion(null)).toBeNull();
    const inactive = { ...program(), active: false, progress: null };
    expect(programWeekCompletion(inactive)).toBeNull();
  });

  it('falls back to week 1 when an active program has no progress and empty days (launch API)', () => {
    const value = { ...program(), active: true, days: [], progress: null };
    expect(programWeekCompletion(value)).toEqual({ week: 1, completed: 0, total: 0, ratio: 0 });
  });

  it('handles a rest-only week without dividing by zero', () => {
    const value = program();
    value.progress!.days = value.progress!.days.filter(day => day.isRestDay);
    expect(programWeekCompletion(value)).toEqual({ week: 2, completed: 0, total: 0, ratio: 0 });
  });

  it('keeps a ten-day training cycle under its program week and permits full completion', () => {
    const value = program();
    value.progress!.days = Array.from({ length: 10 }, (_, position) => ({
      templateId: String(position), status: 'completed', isRestDay: false, position
    }));
    expect(programWeekCompletion(value)).toEqual({ week: 2, completed: 10, total: 10, ratio: 1 });
  });
});
