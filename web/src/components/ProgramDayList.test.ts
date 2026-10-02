import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProgramDayList } from './ProgramDayList';
import type { ProgramStructureEditor } from './useProgramStructureEditor';
import type { DraftWorkout, Exercise } from '../types';

describe('ProgramDayList', () => {
  it('renders days and handles open day modal structure', () => {
    const day: DraftWorkout = {
      lineId: 'day-1',
      week: 1,
      name: 'Day 1',
      focus: null,
      notes: null,
      exercises: [],
      block: 'Block 1',
      phase: 'Phase 1',
      phaseWeek: 1,
      isRestDay: false,
      sourcePage: 1
    };

    const mockStructure = {
      week: {
        week: 1,
        sourceWeek: 1,
        weekId: 'w-1',
        blockId: 'b-1',
        days: [day],
        block: 'Block 1',
        phases: ['Phase 1'],
        pages: [1]
      },
      canAddDay: true,
      duplicateDay: vi.fn(),
      reorderDay: vi.fn(),
      moveDayTo: vi.fn(),
      setDeleteConfirmDay: vi.fn(),
      addDay: vi.fn()
    } as unknown as ProgramStructureEditor;

    const exercises: Exercise[] = [];
    const setOpenDay = vi.fn();
    const onDayChange = vi.fn(async () => {});
    const editing = {
      save: vi.fn(async () => {}),
      count: () => ({ block: 0, program: 0 }),
      keepWrittenName: true
    };

    const markup = renderToStaticMarkup(createElement(ProgramDayList, {
      structure: mockStructure,
      exercises,
      openDay: 'day-1',
      setOpenDay,
      onDayChange,
      editing
    }));

    expect(markup).toContain('day-detail-modal');
    expect(markup).toContain('data-import-day="day-1"');
    expect(markup).toContain('Done');
  });
});
