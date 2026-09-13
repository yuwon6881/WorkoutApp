import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { canComplete, completedSets, duration, showReps, showRpe, showVolume, showWeight, toDisplay, toKg, validReps, validRpe } from './training';

const set = (overrides: Partial<Session['exercises'][number]['sets'][number]> = {}) =>
  ({ id: 'set', position: 0, weightKg: 60, reps: 10, rpe: 8, done: true, ...overrides });

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's', templateId: null, programId: null, name: 'Push', note: '', active: false,
  startedAt: '2026-09-13T10:00:00Z', finishedAt: '2026-09-13T11:00:00Z', revision: 1,
  exercises: [{ id: 'e', exerciseId: null, name: 'Bench press', position: 0, note: '', prescription: [], sets: [set()] }],
  volumeKg: 600, completedSets: 1, ...overrides
});

describe('weight conversion', () => {
  it('keeps kilograms unchanged and converts pounds both ways', () => {
    expect(toDisplay(100, 'kg')).toBe(100);
    expect(toDisplay(100, 'lb')).toBeCloseTo(220.46, 2);
    expect(toKg(220.46, 'lb')).toBeCloseTo(100, 2);
  });

  it('leaves an unknown load unknown rather than turning it into zero', () => {
    expect(toDisplay(null, 'kg')).toBeNull();
    expect(toKg(null, 'lb')).toBeNull();
    expect(showWeight(null, 'kg')).toBe('—');
    expect(showVolume(null, 'lb')).toBe('—');
  });

  it('keeps a genuine bodyweight zero as zero', () => {
    expect(toDisplay(0, 'kg')).toBe(0);
    expect(showWeight(0, 'kg')).toBe('0 kg');
    expect(showVolume(0, 'kg')).toBe('0 kg');
  });

  it('survives a round trip through pounds', () => {
    expect(toKg(toDisplay(82.5, 'lb'), 'lb')).toBeCloseTo(82.5, 2);
  });
});

describe('prescriptions', () => {
  it('shows a single rep target as one number and a range as a range', () => {
    expect(showReps({ repMin: 10, repMax: 10 })).toBe('10');
    expect(showReps({ repMin: 8, repMax: 12 })).toBe('8–12');
  });

  it('renders a missing RPE honestly', () => {
    expect(showRpe(null)).toBe('—');
    expect(showRpe(7.5)).toBe('RPE 7.5');
  });
});

describe('RPE and reps validation', () => {
  it.each([1, 7.5, 8, 10])('accepts %s', value => expect(validRpe(value)).toBe(true));
  it.each([0.5, 10.5, 7.3, null])('rejects %s', value => expect(validRpe(value)).toBe(false));

  it('requires whole positive reps', () => {
    expect(validReps(10)).toBe(true);
    expect(validReps(0)).toBe(false);
    expect(validReps(1.5)).toBe(false);
    expect(validReps(null)).toBe(false);
  });

  it('only allows completing a set that has both reps and an RPE', () => {
    expect(canComplete(set())).toBe(true);
    expect(canComplete(set({ rpe: null }))).toBe(false);
    expect(canComplete(set({ reps: null }))).toBe(false);
    // A blank weight is allowed: the load is simply not recorded.
    expect(canComplete(set({ weightKg: null }))).toBe(true);
  });
});

describe('session summaries', () => {
  it('counts only completed sets', () => {
    const mixed = session({
      exercises: [{ id: 'e', exerciseId: null, name: 'Bench press', position: 0, note: '', prescription: [], sets: [set(), set({ id: 'b', done: false })] }]
    });
    expect(completedSets(mixed)).toHaveLength(1);
  });

  it('measures a finished session from its own timestamps', () => {
    expect(duration(session())).toBe(60);
  });
});
