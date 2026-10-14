import { describe, expect, it } from 'vitest';
import type { ProgramProgressDay } from '../types';
import { dayRowState, inProgressDayId, nextDayId } from './programDayState';

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
