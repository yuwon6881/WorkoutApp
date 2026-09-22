import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { calculateEstimated1Rm, canComplete, completedSets, duration, estimate1Rm, normalizeExerciseName, plannedSets, showClock, showReps, showRpe, showTarget, showVolume, showWeight, toDisplay, toKg, validReps, validRpe } from './training';

const set = (overrides: Partial<Session['exercises'][number]['sets'][number]> = {}) =>
  ({ id: 'set', position: 0, weightKg: 60, reps: 10, rpe: 8, done: true, warmup: false, ...overrides });

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 's', templateId: null, programId: null, name: 'Push', note: '', active: false,
  startedAt: '2026-09-13T10:00:00Z', finishedAt: '2026-09-13T11:00:00Z', revision: 1,
  exercises: [{ id: 'e', exerciseId: null, name: 'Bench press', position: 0, note: '', prescription: [], sets: [set()], sequenceGroup: '', substitutions: [], progression: null }],
  volumeKg: 600, completedSets: 1, warmupSets: 0, ...overrides
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
    expect(showRpe(8)).toBe('2 RIR');
  });

  it('prefers verbatim targets and keeps the machine fallback', () => {
    expect(showTarget({ repMin: 8, repMax: 12, repsText: 'AMRAP', targetRpe: 8, rir: '2' } as never)).toBe('AMRAP · 2 RIR');
  });
});

describe('catalog name parity', () => {
  it.each([
    ['Barbell Bench-Press', 'barbell bench press'],
    [' Constant_Tension  Lying Leg Curl ', 'constant tension lying leg curl'],
    ['Cable / Row 2', 'cable row 2']
  ])('normalizes %s like the API', (value, expected) => expect(normalizeExerciseName(value)).toBe(expected));
});

describe('working and warm-up counts', () => {
  it('does not count warm-up rows as working sets', () => {
    const warmup = set({ warmup: true });
    const warmupPrescription = {
      repMin: 8, repMax: 8, targetRpe: null, restSeconds: null, tempo: null, loadText: null, notes: null,
      repsText: null, restText: null, rir: null, repsSource: 'inferred', rpeSource: 'inferred', restSource: 'inferred', warmup: true
    } as const;
    const mixed = session({ exercises: [{ ...session().exercises[0], prescription: [warmupPrescription], sets: [warmup, set({ id: 'working' })] }] });
    expect(plannedSets(mixed)).toBe(1);
    expect(completedSets(mixed)).toHaveLength(1);
  });
});

describe('RPE and reps validation', () => {
  it.each([6, 7.5, 8, 10])('accepts %s', value => expect(validRpe(value)).toBe(true));
  it.each([0.5, 5.5, 10.5, 7.3, null])('rejects %s', value => expect(validRpe(value)).toBe(false));

  it('requires whole positive reps', () => {
    expect(validReps(10)).toBe(true);
    expect(validReps(0)).toBe(false);
    expect(validReps(1.5)).toBe(false);
    expect(validReps(null)).toBe(false);
  });

  it('allows completing a set with reps before RPE is recorded', () => {
    expect(canComplete(set())).toBe(true);
    expect(canComplete(set({ rpe: null }))).toBe(true);
    expect(canComplete(set({ reps: null }))).toBe(false);
    // A blank weight is allowed: the load is simply not recorded.
    expect(canComplete(set({ weightKg: null }))).toBe(true);
  });
});

describe('session summaries', () => {
  it('counts only completed sets', () => {
    const mixed = session({
      exercises: [{ id: 'e', exerciseId: null, name: 'Bench press', position: 0, note: '', prescription: [], sets: [set(), set({ id: 'b', done: false })], sequenceGroup: '', substitutions: [], progression: null }]
    });
    expect(completedSets(mixed)).toHaveLength(1);
  });

  it('measures a finished session from its own timestamps', () => {
    expect(duration(session())).toBe(60);
  });
});

describe('strength estimate', () => {
  /// These numbers are the same contract the server holds, so a disagreement here is a
  /// disagreement about what the app is telling the user, not a rounding difference.
  it('rates a set as if it had been carried to failure', () => {
    expect(estimate1Rm(60, 3, 8)).toBeCloseTo(60 * (1 + 5 / 30), 6);
    expect(estimate1Rm(100, 1, 10)).toBeCloseTo(100 * (1 + 1 / 30), 6);
  });

  it('gives no estimate where the equation does not hold', () => {
    expect(estimate1Rm(null, 5, 8)).toBeNull();
    expect(estimate1Rm(60, 5, null)).toBeNull();
    // Too easy to say anything, and too many reps for the equation to mean much.
    expect(estimate1Rm(60, 5, 5)).toBeNull();
    expect(estimate1Rm(60, 20, 9)).toBeNull();
    // A bodyweight set carries no load to estimate from.
    expect(estimate1Rm(0, 10, 9)).toBeNull();
  });

  it('calculates estimated 1RM with or without RPE using the Epley relationship', () => {
    // With RPE specified
    expect(calculateEstimated1Rm(60, 3, 8)).toBeCloseTo(60 * (1 + 5 / 30), 6);
    expect(calculateEstimated1Rm(100, 1, 10)).toBeCloseTo(100 * (1 + 1 / 30), 6);
    // Without RPE specified (uses reps at face value)
    expect(calculateEstimated1Rm(60, 5)).toBeCloseTo(60 * (1 + 5 / 30), 6);
    expect(calculateEstimated1Rm(60, 5, null)).toBeCloseTo(60 * (1 + 5 / 30), 6);
    // Boundary conditions
    expect(calculateEstimated1Rm(null, 5)).toBeNull();
    expect(calculateEstimated1Rm(60, 0)).toBeNull();
    expect(calculateEstimated1Rm(60, 15)).toBeNull(); // > 12 reps
    expect(calculateEstimated1Rm(60, 5, 5)).toBeNull(); // RPE < 6
  });

  it('reads a rest clock in minutes and seconds', () => {
    expect(showClock(90)).toBe('1:30');
    expect(showClock(5)).toBe('0:05');
    expect(showClock(0)).toBe('0:00');
  });
});
