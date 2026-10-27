import { describe, expect, it } from 'vitest';
import type { LoggedSet, Session, SetPrescription } from '../types';
import { withEmptyLoadsFilled, type CopiedLoadsLog } from './emptyLoadFill';

const plan = (overrides: Partial<SetPrescription> = {}): SetPrescription => ({
  repMin: 8, repMax: 12, targetRpe: null, restSeconds: 120, tempo: null, loadText: null, notes: null,
  repsText: null, restText: null, rir: '2', warmup: false,
  repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted', ...overrides
});

const set = (id: string, weightKg: number | null, overrides: Partial<LoggedSet> = {}): LoggedSet => ({
  id, position: 0, weightKg, reps: null, rpe: null, done: false, warmup: false, ...overrides
});

const draftWith = (sets: LoggedSet[], prescription: SetPrescription[] = sets.map(() => plan()), name = 'Bench press'): Session => ({
  id: 's', exercises: [{ id: 'e', exerciseId: 'bench', name, loadModel: 'external', sets, prescription }]
} as unknown as Session);

const loads = (draft: Session) => draft.exercises[0].sets.map(item => item.weightKg);

describe('withEmptyLoadsFilled', () => {
  it('copies an entered load into the later empty working sets only', () => {
    const draft = draftWith([set('a', 60), set('b', null), set('c', 55), set('d', null)]);
    expect(loads(withEmptyLoadsFilled(draft, 0, 0, new Map()))).toEqual([60, 60, 55, 60]);
  });

  it('leaves earlier sets, logged sets and warm-ups alone', () => {
    const draft = draftWith(
      [set('w', null, { warmup: true }), set('a', null), set('b', 70), set('c', null, { done: true }), set('d', null)],
      [plan({ warmup: true }), plan(), plan(), plan(), plan()]);
    expect(loads(withEmptyLoadsFilled(draft, 0, 2, new Map()))).toEqual([null, null, 70, null, 70]);
  });

  it('moves its own copies when the source changes, but not a load typed over them', () => {
    const copied: CopiedLoadsLog = new Map();
    let draft = withEmptyLoadsFilled(draftWith([set('a', 60), set('b', null), set('c', null)]), 0, 0, copied);
    draft = { ...draft, exercises: [{ ...draft.exercises[0], sets: draft.exercises[0].sets.map(item => item.id === 'c' ? { ...item, weightKg: 62.5 } : item) }] };
    copied.delete('c');
    draft = { ...draft, exercises: [{ ...draft.exercises[0], sets: draft.exercises[0].sets.map(item => item.id === 'a' ? { ...item, weightKg: 65 } : item) }] };
    expect(loads(withEmptyLoadsFilled(draft, 0, 0, copied))).toEqual([65, 65, 62.5]);
  });

  it('keeps each technique to its own kind', () => {
    const drop = plan({ notes: 'Technique: dropset' });
    const draft = draftWith([set('a', 80), set('b', null), set('c', null)], [plan(), plan(), drop]);
    expect(loads(withEmptyLoadsFilled(draft, 0, 0, new Map()))).toEqual([80, 80, null]);
  });

  it('does nothing for a movement without an editable load', () => {
    const draft = draftWith([set('a', 0), set('b', null)], undefined, 'Plank');
    const reps = { ...draft, exercises: [{ ...draft.exercises[0], loadModel: 'reps_only' }] } as unknown as Session;
    expect(loads(withEmptyLoadsFilled(reps, 0, 0, new Map()))).toEqual([0, null]);
  });
});
