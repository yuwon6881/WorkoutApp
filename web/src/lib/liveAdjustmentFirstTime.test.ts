import { describe, expect, it } from 'vitest';
import type { LoggedSet, Session, SetPrescription } from '../types';
import { withLiveAdjustment, type CopiedLoadsLog, type FilledInputsLog, type LoadGrid } from './liveAdjustment';

const grid: LoadGrid = { stepKg: 2.5, availableLoadsKg: null };

const plan = (overrides: Partial<SetPrescription> = {}): SetPrescription => ({
  repMin: 8, repMax: 12, targetRpe: null, restSeconds: 120, tempo: null, loadText: null, notes: null,
  repsText: null, restText: null, rir: '2', warmup: false,
  repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted', ...overrides
});

// A movement with no history: its sets start blank, with no suggestion behind them.
const blank = (id: string, position: number, overrides: Partial<LoggedSet> = {}): LoggedSet => ({
  id, position, weightKg: null, reps: null, rpe: null, rir: null, done: false, warmup: false, suggestion: null, ...overrides
});

const draftWith = (sets: LoggedSet[], prescription: SetPrescription = plan()): Session => ({
  id: 's', exercises: [{
    id: 'e', exerciseId: 'press', name: 'Machine press', loadModel: 'external', sets, prescription: sets.map(() => prescription)
  }]
} as unknown as Session);

const logged = (draft: Session, index: number, patch: Partial<LoggedSet>): Session => ({
  ...draft,
  exercises: draft.exercises.map(exercise => ({
    ...exercise, sets: exercise.sets.map((item, i) => i === index ? { ...item, done: true, ...patch } : item)
  }))
});

const fresh = () => draftWith([blank('a', 0), blank('b', 1), blank('c', 2)]);

describe('withLiveAdjustment on a movement with no history', () => {
  it('fills the later sets from the first logged set', () => {
    const sets = withLiveAdjustment(logged(fresh(), 0, { weightKg: 60, reps: 10, rpe: 8, rir: '2' }), 0, 0, grid, true, new Map()).exercises[0].sets;
    expect(sets[1]).toMatchObject({ weightKg: 60, reps: 10, rir: '2' });
    expect(sets[2]).toMatchObject({ weightKg: 60, reps: 10, rir: '2' });
  });

  it('asks fewer reps at the target reserve after a first set taken closer to failure', () => {
    const sets = withLiveAdjustment(logged(fresh(), 0, { weightKg: 60, reps: 12, rpe: 10, rir: '0' }), 0, 0, grid, true, new Map()).exercises[0].sets;
    expect(sets[1]).toMatchObject({ weightKg: 60, reps: 10, rir: '2' });
  });

  it('moves to a heavier load after a first set far too light for the range', () => {
    const sets = withLiveAdjustment(logged(fresh(), 0, { weightKg: 40, reps: 12, rpe: 5, rir: '5+' }), 0, 0, grid, true, new Map()).exercises[0].sets;
    expect(sets[1].weightKg).toBeGreaterThan(40);
    expect(sets[1].reps).toBeGreaterThanOrEqual(8);
    expect(sets[1].reps).toBeLessThanOrEqual(12);
  });

  it('carries the fade of the second logged set into the third', () => {
    const filled: FilledInputsLog = new Map();
    const first = withLiveAdjustment(logged(fresh(), 0, { weightKg: 60, reps: 10, rpe: 8, rir: '2' }), 0, 0, grid, true, filled);
    const second = withLiveAdjustment(logged(first, 1, { reps: 8 }), 0, 1, grid, true, filled);
    // Two reps lost from the first set to the second project two more by the third: 60 × 6, or lighter.
    const third = second.exercises[0].sets[2];
    expect(third.weightKg! < 60 || third.reps! < 8).toBe(true);
    expect(third.rir).toBe('2');
  });

  it('fills reps without effort when RIR is not tracked', () => {
    const draft = logged(fresh(), 0, { weightKg: 60, reps: 9 });
    const sets = withLiveAdjustment(draft, 0, 0, grid, false, new Map()).exercises[0].sets;
    expect(sets[1]).toMatchObject({ weightKg: 60, reps: 9, rpe: null, rir: null });
  });

  it('takes a load copied into a blank set but never one the lifter typed', () => {
    const draft = draftWith([blank('a', 0), blank('b', 1, { weightKg: 60 }), blank('c', 2, { weightKg: 50 })]);
    const copied: CopiedLoadsLog = new Map([['b', 60]]);
    const sets = withLiveAdjustment(logged(draft, 0, { weightKg: 60, reps: 11, rpe: 8, rir: '2' }), 0, 0, grid, true, new Map(), copied).exercises[0].sets;
    expect(sets[1]).toMatchObject({ weightKg: 60, reps: 11 });
    expect(sets[2]).toMatchObject({ weightKg: 50, reps: null });
    expect(copied.has('b')).toBe(false);
  });

  it('re-aims its own fill when the first set is corrected', () => {
    const filled: FilledInputsLog = new Map();
    const first = withLiveAdjustment(logged(fresh(), 0, { weightKg: 60, reps: 10, rpe: 8, rir: '2' }), 0, 0, grid, true, filled);
    const corrected = withLiveAdjustment(logged(first, 0, { reps: 12 }), 0, 0, grid, true, filled);
    expect(corrected.exercises[0].sets[1]).toMatchObject({ weightKg: 60, reps: 12 });
  });

  // The server prefills a first session's reps with the program's target (never a load or effort),
  // so a later set already shows "10" when the first one is logged; that is still the app's to move.
  describe('with the program target prefilled into the later sets', () => {
    const targeted = (id: string, position: number, overrides: Partial<LoggedSet> = {}) => blank(id, position, {
      reps: 10,
      suggestion: {
        suggestedLoadKg: null, suggestedReps: 10, reason: 'No history', sourceSessionId: null, sourceDate: null, progressionMode: 'none',
        nutritionContextRevision: null, isBodyweightAdjustment: false, suggestedSystemLoadKg: null, resistanceMode: 'external'
      },
      ...overrides
    });
    const exactTen = plan({ repMin: 10, repMax: 10, rir: '3' });

    it('steers the later sets after a first set taken closer to failure than the target', () => {
      const draft = draftWith([blank('a', 0, { weightKg: 70 }), targeted('b', 1, { weightKg: 70 }), targeted('c', 2, { weightKg: 70 })], exactTen);
      const copied: CopiedLoadsLog = new Map([['b', 70], ['c', 70]]);
      const sets = withLiveAdjustment(logged(draft, 0, { reps: 10, rpe: 9, rir: '1' }), 0, 0, grid, true, new Map(), copied).exercises[0].sets;
      expect(sets[1].weightKg).toBeLessThan(70);
      expect(sets[1]).toMatchObject({ reps: 10, rir: '3' });
      expect(sets[2].weightKg).toBe(sets[1].weightKg);
    });

    it('never moves a set whose reps the lifter changed', () => {
      const draft = draftWith([blank('a', 0, { weightKg: 70 }), targeted('b', 1, { weightKg: 70, reps: 9 })], exactTen);
      const copied: CopiedLoadsLog = new Map([['b', 70]]);
      const sets = withLiveAdjustment(logged(draft, 0, { reps: 10, rpe: 9, rir: '1' }), 0, 0, grid, true, new Map(), copied).exercises[0].sets;
      expect(sets[1]).toMatchObject({ weightKg: 70, reps: 9 });
    });
  });

  it('leaves a movement with no rep target alone', () => {
    const draft = logged(draftWith([blank('a', 0), blank('b', 1)], plan({ repMin: null, repMax: null })), 0, { weightKg: 60, reps: 10 });
    expect(withLiveAdjustment(draft, 0, 0, grid, true, new Map())).toBe(draft);
  });
});
