import { describe, expect, it } from 'vitest';
import type { SessionExercise, SetPrescription } from '../types';
import { parseRestRange, planRestRange, sessionHasRestRange } from './restRange';

function makePrescription(overrides: Partial<SetPrescription> = {}): SetPrescription {
  return {
    repMin: 8,
    repMax: 10,
    targetRpe: 8,
    restSeconds: 150,
    tempo: null,
    loadText: null,
    notes: null,
    repsText: null,
    restText: '2-3 min',
    rir: null,
    warmup: false,
    repsSource: 'userEdited',
    rpeSource: 'userEdited',
    restSource: 'userEdited',
    ...overrides
  };
}

function makeExercise(prescriptions: SetPrescription[]): SessionExercise {
  return {
    id: 'ex-1',
    exerciseId: 'ex-1',
    name: 'Bench Press',
    position: 0,
    note: '',
    sequenceGroup: '',
    substitutions: [],
    progression: null,
    prescription: prescriptions,
    sets: prescriptions.map((p, i) => ({
      id: `s-${i}`,
      position: i,
      weightKg: 60,
      reps: 8,
      rpe: 8,
      done: false,
      warmup: p.warmup
    }))
  };
}

describe('parseRestRange', () => {
  it('parses "2-3 min" into 120/180/150', () => {
    expect(parseRestRange('2-3 min')).toEqual({
      minSeconds: 120,
      maxSeconds: 180,
      balancedSeconds: 150
    });
  });

  it('parses "90-120 sec" into 90/120/105', () => {
    expect(parseRestRange('90-120 sec')).toEqual({
      minSeconds: 90,
      maxSeconds: 120,
      balancedSeconds: 105
    });
  });

  it('parses "60-90s" into 60/90/75', () => {
    expect(parseRestRange('60-90s')).toEqual({
      minSeconds: 60,
      maxSeconds: 90,
      balancedSeconds: 75
    });
  });

  it('parses "2 – 3 minutes" with en dash', () => {
    expect(parseRestRange('2 – 3 minutes')).toEqual({
      minSeconds: 120,
      maxSeconds: 180,
      balancedSeconds: 150
    });
  });

  it('parses "2 to 3 min"', () => {
    expect(parseRestRange('2 to 3 min')).toEqual({
      minSeconds: 120,
      maxSeconds: 180,
      balancedSeconds: 150
    });
  });

  it('returns null for single numbers like "3 min"', () => {
    expect(parseRestRange('3 min')).toBeNull();
  });

  it('returns null when min equals max like "3-3 min"', () => {
    expect(parseRestRange('3-3 min')).toBeNull();
  });

  it('returns null for null, empty or undefined text', () => {
    expect(parseRestRange(null)).toBeNull();
    expect(parseRestRange(undefined)).toBeNull();
    expect(parseRestRange('')).toBeNull();
  });

  it('parses "10-15" with no unit as seconds because average 12.5 > 10', () => {
    expect(parseRestRange('10-15')).toEqual({
      minSeconds: 10,
      maxSeconds: 15,
      balancedSeconds: 13
    });
  });

  it('parses "1.5-2" with no unit as minutes because average 1.75 <= 10', () => {
    expect(parseRestRange('1.5-2')).toEqual({
      minSeconds: 90,
      maxSeconds: 120,
      balancedSeconds: 105
    });
  });

  it('returns null if maxSeconds exceeds 3600', () => {
    expect(parseRestRange('60-70 min')).toBeNull();
  });
});

describe('planRestRange', () => {
  it('reads the range from the given set prescription', () => {
    const ex = makeExercise([
      makePrescription({ restText: '90-120 sec', restSeconds: 105 }),
      makePrescription({ restText: '2-3 min', restSeconds: 150 })
    ]);
    expect(planRestRange(ex, 0)).toEqual({
      minSeconds: 90,
      maxSeconds: 120,
      balancedSeconds: 105
    });
    expect(planRestRange(ex, 1)).toEqual({
      minSeconds: 120,
      maxSeconds: 180,
      balancedSeconds: 150
    });
  });

  it('falls back to the first working set when setIndex has no restText', () => {
    const ex = makeExercise([
      makePrescription({ warmup: true, restText: null, restSeconds: null }),
      makePrescription({ warmup: false, restText: '2-3 min', restSeconds: 150 })
    ]);
    expect(planRestRange(ex, 0)).toEqual({
      minSeconds: 120,
      maxSeconds: 180,
      balancedSeconds: 150
    });
  });

  it('falls back to prescription[0] if all sets are warmups and target has no restText', () => {
    const ex = makeExercise([
      makePrescription({ warmup: true, restText: '60-90s', restSeconds: 75 }),
      makePrescription({ warmup: true, restText: null, restSeconds: null })
    ]);
    expect(planRestRange(ex, 1)).toEqual({
      minSeconds: 60,
      maxSeconds: 90,
      balancedSeconds: 75
    });
  });

  it('sanity guard: returns null when stored restSeconds differs by more than 1 second from balancedSeconds', () => {
    const ex = makeExercise([
      makePrescription({ restText: '2-3 min', restSeconds: 90 }) // balanced is 150, stored is 90
    ]);
    expect(planRestRange(ex, 0)).toBeNull();
  });

  it('sanity guard: allows stored restSeconds within 1 second of balancedSeconds', () => {
    const ex = makeExercise([
      makePrescription({ restText: '2-3 min', restSeconds: 151 })
    ]);
    expect(planRestRange(ex, 0)).toEqual({
      minSeconds: 120,
      maxSeconds: 180,
      balancedSeconds: 150
    });
  });

  it('returns null if exercise has empty prescription', () => {
    const ex = makeExercise([]);
    expect(planRestRange(ex, 0)).toBeNull();
  });
});

describe('sessionHasRestRange', () => {
  it('returns true if any exercise has a usable rest range', () => {
    const ex1 = makeExercise([makePrescription({ restText: null, restSeconds: 90 })]);
    const ex2 = makeExercise([makePrescription({ restText: '2-3 min', restSeconds: 150 })]);
    expect(sessionHasRestRange([ex1, ex2])).toBe(true);
  });

  it('returns false if no exercises have a usable rest range', () => {
    const ex1 = makeExercise([makePrescription({ restText: null, restSeconds: 90 })]);
    const ex2 = makeExercise([makePrescription({ restText: '3 min', restSeconds: 180 })]);
    expect(sessionHasRestRange([ex1, ex2])).toBe(false);
  });
});
