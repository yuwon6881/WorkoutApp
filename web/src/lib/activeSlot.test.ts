import { describe, expect, it } from 'vitest';
import type { Program, ProgramSummary, SetPrescription, Template } from '../types';
import { hasSlotProgress, isSlotItemFinished, programToDraft } from './activeSlot';

const set: SetPrescription = {
  repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null, repsText: null, restText: null,
  rir: '2', warmup: false, repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted'
};

function template(overrides: Partial<Template> = {}): Template {
  return {
    id: 't1', programId: null, name: 'Push', focus: '', note: '', week: 1, position: 0, revision: 1, block: '', phase: '',
    phaseWeek: 1, isRestDay: false, exercises: [{ id: 'e1', exerciseId: 'bench', sourceName: 'Bench', name: 'Bench press', note: '',
      position: 0, sets: [set], sequenceGroup: '', substitutions: [] }],
    ...overrides
  };
}

function program(overrides: Partial<ProgramSummary> = {}): ProgramSummary {
  return {
    id: 'p1', name: 'Block', weeks: 2, active: true, revision: 3, sourceImportId: null, completedTemplateIds: [], nextTemplateId: 'd1',
    lifecycleStatus: 'active',
    days: [
      { id: 'd1', name: 'Day A', focus: '', block: '', phase: '', week: 1, phaseWeek: 1, position: 0, isRestDay: false, exerciseCount: 1 },
      { id: 'd2', name: 'Day B', focus: '', block: '', phase: '', week: 2, phaseWeek: 2, position: 0, isRestDay: false, exerciseCount: 1 }
    ],
    progress: { runId: 'r1', currentWeek: 1, currentAttempt: 1, passedDays: 0, totalDays: 1, days: [] },
    ...overrides
  };
}

describe('active slot progress', () => {
  it('treats a fresh first week as no progress', () => {
    expect(hasSlotProgress({ kind: 'program', program: program() })).toBe(false);
  });

  it('counts passed days, later weeks, week resets, and a finished run as progress', () => {
    const base = program().progress!;
    expect(hasSlotProgress({ kind: 'program', program: program({ progress: { ...base, passedDays: 1 } }) })).toBe(true);
    expect(hasSlotProgress({ kind: 'program', program: program({ progress: { ...base, currentWeek: 2 } }) })).toBe(true);
    expect(hasSlotProgress({ kind: 'program', program: program({ progress: { ...base, currentAttempt: 2 } }) })).toBe(true);
    const finished = program({ lifecycleStatus: 'completed', nextTemplateId: null });
    expect(hasSlotProgress({ kind: 'program', program: finished })).toBe(true);
    expect(isSlotItemFinished({ kind: 'program', program: finished })).toBe(true);
  });

  it('never reports progress for a library program', () => {
    expect(hasSlotProgress({ kind: 'program', program: program({ active: false, lifecycleStatus: 'completed' }) })).toBe(false);
  });

  it('treats a standalone workout as finished only once its active run is ticked', () => {
    expect(hasSlotProgress({ kind: 'template', template: template({ active: true }) })).toBe(false);
    const done = template({ active: true, activeCompletedAt: '2026-10-02T10:00:00Z' });
    expect(hasSlotProgress({ kind: 'template', template: done })).toBe(true);
    expect(isSlotItemFinished({ kind: 'template', template: done })).toBe(true);
  });
});

describe('programToDraft', () => {
  it('maps saved days and exercises into the editor document in week and position order', () => {
    const saved: Program = {
      ...program(),
      workouts: [
        template({ id: 'd2', programId: 'p1', name: 'Day B', week: 2, block: 'Base', phase: 'Accumulation', phaseWeek: 2 }),
        template({ id: 'd1', programId: 'p1', name: 'Day A', week: 1, block: 'Base', phase: 'Accumulation', sourcePage: 4 })
      ]
    };
    const draft = programToDraft(saved);
    expect(draft.programName).toBe('Block');
    expect(draft.workouts.map(day => day.lineId)).toEqual(['d1', 'd2']);
    expect(draft.workouts[0]).toMatchObject({ block: 'Base', phase: 'Accumulation', sourcePage: 4, focus: null });
    expect(draft.workouts[0].exercises[0]).toMatchObject({ lineId: 'e1', sourceName: 'Bench press', exerciseId: 'bench' });
    expect(draft.workouts[0].exercises[0].sets[0]).toMatchObject({ repMin: 8, repMax: 10, rir: '2', warmup: false });
  });
});
