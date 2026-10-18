import { describe, expect, it } from 'vitest';
import type { LoggedSet, Session, SetPrescription, SetProgressionSuggestion } from '../types';
import { targetReserve, withLiveAdjustment, type FilledInputsLog, type LoadGrid } from './liveAdjustment';

const grid: LoadGrid = { stepKg: 2.5, availableLoadsKg: null };

const plan = (overrides: Partial<SetPrescription> = {}): SetPrescription => ({
  repMin: 8, repMax: 12, targetRpe: null, restSeconds: 120, tempo: null, loadText: null, notes: null,
  repsText: null, restText: null, rir: '2', warmup: false,
  repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted', ...overrides
});

const suggestion = (load: number | null, reps: number): SetProgressionSuggestion => ({
  suggestedLoadKg: load, suggestedReps: reps, reason: 'Progress.', sourceSessionId: 'last', sourceDate: '2026-10-05T10:00:00Z',
  progressionMode: 'normal', nutritionContextRevision: null, isBodyweightAdjustment: false, suggestedSystemLoadKg: null, resistanceMode: 'external'
});

const set = (id: string, position: number, load: number, reps: number, overrides: Partial<LoggedSet> = {}): LoggedSet => ({
  id, position, weightKg: load, reps, rpe: 8, rir: '2', done: false, warmup: false, suggestion: suggestion(load, reps), ...overrides
});

const draftWith = (sets: LoggedSet[], prescription: SetPrescription = plan()): Session => ({
  id: 's', exercises: [{
    id: 'e', exerciseId: 'bench', name: 'Bench press', loadModel: 'external', sets, prescription: sets.map(() => prescription)
  }]
} as unknown as Session);

const logged = (draft: Session, index: number, patch: Partial<LoggedSet>): Session => ({
  ...draft,
  exercises: draft.exercises.map(exercise => ({
    ...exercise, sets: exercise.sets.map((item, i) => i === index ? { ...item, done: true, ...patch } : item)
  }))
});

const adjust = (draft: Session, index = 0, filled: FilledInputsLog = new Map()) =>
  withLiveAdjustment(draft, 0, index, grid, true, filled).exercises[0].sets;

const three = () => draftWith([set('a', 0, 60, 10), set('b', 1, 60, 10), set('c', 2, 60, 10)]);

describe('withLiveAdjustment', () => {
  it('leaves later sets alone when the logged set was on plan', () => {
    const draft = logged(three(), 0, { reps: 10, rpe: 8, rir: '2' });
    expect(withLiveAdjustment(draft, 0, 0, grid, true, new Map())).toBe(draft);
  });

  it('ignores a one-rep wobble', () => {
    const draft = logged(three(), 0, { reps: 9, rpe: 8, rir: '2' });
    expect(withLiveAdjustment(draft, 0, 0, grid, true, new Map())).toBe(draft);
  });

  it('lowers the load for the next sets after a much harder set', () => {
    const sets = adjust(logged(three(), 0, { reps: 8, rpe: 10, rir: '0' }));
    expect(sets[1].weightKg).toBeLessThan(60);
    expect(sets[1].weightKg! % 2.5).toBeCloseTo(0, 5);
    expect(sets[2].weightKg).toBe(sets[1].weightKg);
    expect(sets[1].reps).toBeGreaterThanOrEqual(8);
    expect(sets[1].reps).toBeLessThanOrEqual(12);
  });

  it('raises the load after a set far easier than planned', () => {
    const sets = adjust(logged(three(), 0, { reps: 12, rpe: null, rir: '5+' }));
    expect(sets[1].weightKg).toBeGreaterThan(60);
    expect(sets[1].reps).toBeLessThanOrEqual(12);
  });

  it('keeps the load but changes reps and reserve when the range absorbs the difference', () => {
    const draft = draftWith([set('a', 0, 60, 8), set('b', 1, 60, 8)]);
    const sets = adjust(logged(draft, 0, { reps: 10, rpe: 8, rir: '2' }));
    expect(sets[1].weightKg).toBe(60);
    expect(sets[1].reps).toBe(10);
  });

  it('moves reps, never the load, on equipment set to progress through reps alone', () => {
    const sets = withLiveAdjustment(logged(three(), 0, { reps: 8, rpe: 10, rir: '0' }), 0, 0,
      { stepKg: 0, availableLoadsKg: null }, true, new Map()).exercises[0].sets;
    expect(sets[1].weightKg).toBe(60);
    expect(sets[1].reps).toBeLessThan(10);
  });

  it('does not steer by an AMRAP set, whose one-rep bound is only a placeholder', () => {
    const amrap = plan({ repMin: 1, repMax: 1, repsText: 'AMRAP', rir: null });
    const draft = draftWith([set('a', 0, 60, 12), set('b', 1, 60, 12)], amrap);
    const after = logged(draft, 0, { reps: 6, rpe: 10, rir: '0' });
    expect(withLiveAdjustment(after, 0, 0, grid, true, new Map())).toBe(after);
  });

  it('moves the load for an exact rep target', () => {
    const exact = plan({ repMin: 5, repMax: 5 });
    const draft = draftWith([set('a', 0, 100, 5), set('b', 1, 100, 5)], exact);
    const sets = adjust(logged(draft, 0, { reps: 3, rpe: 10, rir: '0' }));
    expect(sets[1].weightKg).toBeLessThan(100);
    expect(sets[1].reps).toBe(5);
  });

  it('never overwrites a value the lifter typed', () => {
    const draft = draftWith([set('a', 0, 60, 10), set('b', 1, 60, 10, { weightKg: 55 })]);
    expect(withLiveAdjustment(logged(draft, 0, { reps: 8, rpe: 10, rir: '0' }), 0, 0, grid, true, new Map()).exercises[0].sets[1].weightKg).toBe(55);
  });

  it('returns the sets to the program fill when a later set is back on plan', () => {
    const filled: FilledInputsLog = new Map();
    const hard = withLiveAdjustment(logged(three(), 0, { reps: 8, rpe: 10, rir: '0' }), 0, 0, grid, true, filled);
    expect(hard.exercises[0].sets[2].weightKg).toBeLessThan(60);
    const back = withLiveAdjustment(logged(hard, 1, { weightKg: 60, reps: 10, rpe: 8, rir: '2' }), 0, 1, grid, true, filled);
    expect(back.exercises[0].sets[2]).toMatchObject({ weightKg: 60, reps: 10, rir: '2' });
  });

  it('does not touch warm-ups, techniques, logged sets, or a first time with no history', () => {
    const technique = plan({ notes: 'Myo-reps' });
    const draft = draftWith([set('a', 0, 60, 10), set('b', 1, 60, 10, { done: true }), set('c', 2, 60, 10, { suggestion: null })]);
    draft.exercises[0].prescription[1] = technique;
    const result = adjust(logged(draft, 0, { reps: 8, rpe: 10, rir: '0' }));
    expect(result[1]).toEqual(draft.exercises[0].sets[1]);
    expect(result[2].weightKg).toBe(60);
  });

  it('adjusts a workout started before effort was prefilled', () => {
    const draft = draftWith([set('a', 0, 60, 10), set('b', 1, 60, 10, { rpe: null, rir: null })]);
    expect(adjust(logged(draft, 0, { reps: 8, rpe: 10, rir: '0' }))[1].weightKg).toBeLessThan(60);
  });

  it('adjusts load and reps without touching effort when reserve is not tracked', () => {
    const draft = draftWith([set('a', 0, 60, 10, { rpe: null, rir: null }), set('b', 1, 60, 10, { rpe: null, rir: null })]);
    const result = withLiveAdjustment(logged(draft, 0, { reps: 6 }), 0, 0, grid, false, new Map()).exercises[0].sets[1];
    expect(result.rir).toBeNull();
    expect(result.rpe).toBeNull();
    expect(result.weightKg).toBeLessThan(60);
  });

  describe('near the smallest load the equipment can be set to', () => {
    const smallest = () => draftWith([set('a', 0, 2.5, 10), set('b', 1, 2.5, 10)]);
    const missBadly = { reps: 1, rpe: 10, rir: '0' };

    it('never floors a step grid load to zero after a big miss', () => {
      const result = withLiveAdjustment(logged(smallest(), 0, missBadly), 0, 0, grid, true, new Map()).exercises[0].sets[1];
      expect(result.weightKg).toBe(2.5);
      expect(result.reps).toBeGreaterThanOrEqual(8);
      expect(result.reps).toBeLessThanOrEqual(12);
    });

    it('keeps a weight list load at its smallest entry after a big miss', () => {
      const listGrid: LoadGrid = { stepKg: 2.5, availableLoadsKg: [2.5, 5, 7.5] };
      const result = withLiveAdjustment(logged(smallest(), 0, missBadly), 0, 0, listGrid, true, new Map()).exercises[0].sets[1];
      expect(result.weightKg).toBe(2.5);
    });

    it('never rounds an exact-target load to zero', () => {
      const exact = plan({ repMin: 5, repMax: 5 });
      const draft = draftWith([set('a', 0, 1.25, 5), set('b', 1, 1.25, 5)], exact);
      const result = withLiveAdjustment(logged(draft, 0, { reps: 1, rpe: 10, rir: '0' }), 0, 0, grid, true, new Map()).exercises[0].sets[1];
      expect(result.weightKg).toBeGreaterThan(0);
      expect(Number.isFinite(result.reps)).toBe(true);
    });
  });
});

describe('targetReserve', () => {
  it.each([['3', null, 3], ['1-2', null, 1], ['1+', null, 1], ['5+', null, 5], [null, 8, 2], [null, null, 2]] as const)(
    'reads %s / RPE %s as %s', (rir, rpe, expected) => {
      expect(targetReserve(plan({ rir, targetRpe: rpe }))).toBe(expected);
    });
});
