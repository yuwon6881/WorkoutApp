import { describe, expect, it } from 'vitest';
import type { Exercise, LoggedSet, Session, SetPrescription } from '../types';
import { warmupOffer, withWarmups } from './workoutWarmups';

const plan = (overrides: Partial<SetPrescription> = {}): SetPrescription => ({
  repMin: 5, repMax: 5, targetRpe: null, restSeconds: 180, tempo: null, loadText: null, notes: null,
  repsText: null, restText: null, rir: '2', warmup: false,
  repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted', ...overrides
});
const set = (id: string, weightKg: number | null, overrides: Partial<LoggedSet> = {}): LoggedSet => ({
  id, position: 0, weightKg, reps: 5, rpe: null, done: false, warmup: false, ...overrides
});
const catalog = [{ id: 'squat', name: 'Back squat', equipment: 'Barbell', muscle: 'Quads', loadStepKg: 2.5 }] as Exercise[];
const draftWith = (sets: LoggedSet[], prescription: SetPrescription[]): Session => ({
  id: 's', bodyWeight: { referenceKg: 80 },
  exercises: [{ id: 'e', exerciseId: 'squat', name: 'Back squat', loadModel: 'external', sets, prescription }]
} as unknown as Session);

describe('warmupOffer', () => {
  it('recommends a ramp for the first working load and counts the planned warm-ups', () => {
    const offer = warmupOffer(draftWith([set('w', null, { warmup: true, reps: null }), set('a', 120), set('b', 120)],
      [plan({ warmup: true }), plan(), plan()]), 0, catalog, 'kg')!;
    expect(offer.existing).toBe(1);
    expect(offer.recommended).toBe(4);
    expect(offer.steps(1)).toEqual([{ weightKg: 70, reps: 8 }]);
  });

  it('is gone when the planned warm-ups are filled and already enough', () => {
    const filled = draftWith([set('w1', 20, { warmup: true }), set('w2', 35, { warmup: true }), set('a', 50)],
      [plan({ warmup: true }), plan({ warmup: true }), plan()]);
    expect(warmupOffer(filled, 0, catalog, 'kg')).toBeNull();
  });

  it('waits for a working load, and is gone once a working set is logged', () => {
    const empty = warmupOffer(draftWith([set('a', null)], [plan()]), 0, catalog, 'kg')!;
    expect(empty.workingKg).toBeNull();
    expect(empty.steps(2)).toEqual([]);
    expect(warmupOffer(draftWith([set('a', 100, { done: true }), set('b', 100)], [plan(), plan()]), 0, catalog, 'kg')).toBeNull();
  });
});

describe('withWarmups', () => {
  const steps = [{ weightKg: 20, reps: 8 }, { weightKg: 60, reps: 5 }, { weightKg: 80, reps: 3 }];

  it('adds a leading block of warm-ups with their own targets and short rest', () => {
    const next = withWarmups(draftWith([set('a', 100), set('b', 100)], [plan(), plan()]), 0, steps).exercises[0];
    expect(next.sets.map(item => [item.warmup, item.weightKg, item.reps])).toEqual([
      [true, 20, 8], [true, 60, 5], [true, 80, 3], [false, 100, 5], [false, 100, 5]
    ]);
    expect(next.sets.map(item => item.position)).toEqual([0, 1, 2, 3, 4]);
    expect(next.prescription.slice(0, 3).map(item => [item.warmup, item.repMin, item.restSeconds, item.rir])).toEqual([
      [true, 8, 60, null], [true, 5, 60, null], [true, 3, 60, null]
    ]);
  });

  it('fills a planned warm-up in place without replacing what the lifter typed', () => {
    const draft = draftWith([set('w1', null, { warmup: true, reps: 10 }), set('a', 100)], [plan({ warmup: true }), plan()]);
    const kept = withWarmups(draft, 0, [{ weightKg: 60, reps: 8 }]).exercises[0];
    expect(kept.sets.map(item => [item.id, item.weightKg, item.reps])).toEqual([['w1', 60, 10], ['a', 100, 5]]);
  });

  it('adds the missing lighter steps in front of a planned warm-up when more are chosen', () => {
    const draft = draftWith([set('w1', null, { warmup: true, reps: null }), set('a', 100)], [plan({ warmup: true }), plan()]);
    const next = withWarmups(draft, 0, steps).exercises[0];
    expect(next.sets.map(item => [item.warmup, item.weightKg])).toEqual([[true, 20], [true, 60], [true, 80], [false, 100]]);
    expect(next.sets[2].id).toBe('w1');
  });
});
