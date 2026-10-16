import { describe, expect, it } from 'vitest';
import type { ProgramProgressDay, ProgramSummary } from '../types';
import { dayRowState, inProgressDayId, nextDayId, passableRestDayId, programDayActionInput } from './programDayState';

const day = (templateId: string, status: ProgramProgressDay['status'] = 'pending', isRestDay = false): ProgramProgressDay =>
  ({ templateId, status, isRestDay, position: 0 });

describe('program day row state', () => {
  const week = [day('a', 'completed'), day('b'), day('c'), day('rest', 'pending', true)];

  it('finds no running day without an open workout', () => {
    expect(inProgressDayId(week, 'b', false)).toBeNull();
    expect(inProgressDayId(week, null, true)).toBeNull();
    expect(inProgressDayId(week, undefined, true)).toBeNull();
  });

  it('ignores an open workout that did not start from this week', () => {
    expect(inProgressDayId(week, 'elsewhere', true)).toBeNull();
  });

  it('never treats a passed or rest day as running', () => {
    expect(inProgressDayId(week, 'a', true)).toBeNull();
    expect(inProgressDayId(week, 'rest', true)).toBeNull();
  });

  it('names the pending day the open workout started from', () => {
    expect(inProgressDayId(week, 'c', true)).toBe('c');
  });

  it('moves Next past the running day instead of repeating it', () => {
    expect(nextDayId(week, new Set(), null)).toBe('b');
    expect(nextDayId(week, new Set(), 'b')).toBe('c');
    expect(nextDayId(week, new Set(), 'c')).toBe('b');
  });

  it('skips days passed optimistically and finds no Next when nothing is left', () => {
    expect(nextDayId(week, new Set(['b']), null)).toBe('c');
    expect(nextDayId([day('a', 'completed'), day('b')], new Set(), 'b')).toBeUndefined();
    expect(nextDayId([], new Set(), null)).toBeUndefined();
  });

  it('labels the running day in progress and only the following day next', () => {
    const next = nextDayId(week, new Set(), 'b');
    expect(dayRowState(week[0], next, 'b')).toBe('completed');
    expect(dayRowState(week[1], next, 'b')).toBe('in-progress');
    expect(dayRowState(week[2], next, 'b')).toBe('next');
    expect(dayRowState(day('later'), next, 'b')).toBe('upcoming');
  });

  it('keeps Next on the first pending day when nothing is running', () => {
    const next = nextDayId(week, new Set(), null);
    expect(dayRowState(week[1], next, null)).toBe('next');
    expect(dayRowState(week[2], next, null)).toBe('upcoming');
  });

  it('reads skipped days as skipped even when they were once the running day', () => {
    expect(dayRowState(day('s', 'skipped'), undefined, 's')).toBe('skipped');
  });
});

const programWith = (days: ProgramProgressDay[], overrides: Partial<ProgramSummary> = {}): ProgramSummary => ({
  id: 'p', name: 'Program', weeks: 4, active: true, revision: 7, sourceImportId: null, days: [], completedTemplateIds: [], nextTemplateId: null,
  progress: { runId: 'run-1', currentWeek: 2, currentAttempt: 3, passedDays: 0, totalDays: days.length, days }, ...overrides
});

describe('program day action input', () => {
  it('names the revision, run, week and attempt the server checks, with a fresh idempotency id', () => {
    const first = programDayActionInput(programWith([day('r', 'pending', true)]));
    expect(first).toMatchObject({ revision: 7, runId: 'run-1', week: 2, attempt: 3 });
    expect(first.idempotencyId).not.toBe(programDayActionInput(programWith([])).idempotencyId);
  });

  it('refuses a program whose week is not loaded', () => {
    expect(() => programDayActionInput(programWith([], { progress: null }))).toThrow(/current program week/);
  });
});

describe('passable rest day', () => {
  const days = [day('t1', 'completed'), day('r1', 'pending', true), day('r2', 'pending', true)];

  it('names the first pending rest day, or the preferred one when it is pending', () => {
    expect(passableRestDayId(programWith(days))).toBe('r1');
    expect(passableRestDayId(programWith(days), 'r2')).toBe('r2');
  });

  it('is absent when nothing can be passed', () => {
    expect(passableRestDayId(programWith(days, { active: false }))).toBeNull();
    expect(passableRestDayId(programWith(days, { progress: { ...programWith(days).progress!, runId: 'optimistic' } }))).toBeNull();
    expect(passableRestDayId(programWith([day('t1', 'pending'), day('r1', 'completed', true)]))).toBeNull();
    expect(passableRestDayId(programWith(days), 't1')).toBe('r1');
    expect(passableRestDayId(null)).toBeNull();
  });
});
