import { describe, expect, it } from 'vitest';
import type { LoggedSet, SessionExercise, SetPrescription, SetProgressionSuggestion } from '../types';
import { setTarget } from './setTarget';

const plan = (overrides: Partial<SetPrescription> = {}): SetPrescription => ({
  repMin: 8, repMax: 12, targetRpe: null, restSeconds: 120, tempo: null, loadText: null, notes: null,
  repsText: null, restText: null, rir: '2', warmup: false,
  repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted', ...overrides
});

const suggestion = (overrides: Partial<SetProgressionSuggestion> = {}): SetProgressionSuggestion => ({
  suggestedLoadKg: 50, suggestedReps: 9, reason: 'Last time was harder than the target effort: aim for 9 reps at the same load to land on it.',
  sourceSessionId: 'previous-session', sourceDate: '2026-10-05T10:00:00Z', progressionMode: 'normal',
  nutritionContextRevision: null, isBodyweightAdjustment: false, suggestedSystemLoadKg: null, resistanceMode: 'external',
  ...overrides
});

const set = (overrides: Partial<LoggedSet> = {}): LoggedSet => ({
  id: 'set-1', position: 0, weightKg: 50, reps: 9, rpe: null, done: false, warmup: false, suggestion: suggestion(), ...overrides
});

const barbell: Pick<SessionExercise, 'name' | 'loadModel' | 'trackingMode'> = { name: 'Bench press', loadModel: 'external' };

describe('setTarget', () => {
  it('shows the progression target the inputs were filled with, at the program effort', () => {
    const target = setTarget(set(), plan(), barbell, 'kg', true);
    expect(target).toEqual({ reps: '9 · 2 RIR', load: '50 kg', reason: suggestion().reason });
  });

  it('keeps an exact rep target and a lighter load from a hard last session', () => {
    const target = setTarget(set({ suggestion: suggestion({ suggestedLoadKg: 55, suggestedReps: 8 }) }),
      plan({ repMin: 8, repMax: 8, rir: null, targetRpe: 8 }), barbell, 'kg', true);
    expect(target.reps).toBe('8 · 2 RIR');
    expect(target.load).toBe('55 kg');
  });

  it('never invents a rep count for an AMRAP set or one with no rep target', () => {
    expect(setTarget(set(), plan({ repsText: 'AMRAP', repMin: 1, repMax: 1 }), barbell, 'kg', true).reps).toBe('AMRAP · 2 RIR');
    expect(setTarget(set(), plan({ repMin: null, repMax: null }), barbell, 'kg', true).reps).toBe('— · 2 RIR');
  });

  it('shows the plan target for a first session, with the reason it gives', () => {
    const first = suggestion({ sourceSessionId: null, sourceDate: null, suggestedLoadKg: null, reason: 'First time through.' });
    expect(setTarget(set({ suggestion: first }), plan(), barbell, 'kg', true))
      .toEqual({ reps: '8–12 · 2 RIR', load: null, reason: 'First time through.' });
  });

  it('shows the plan target for a set added mid-workout', () => {
    expect(setTarget(set({ suggestion: null }), plan(), barbell, 'kg', true))
      .toEqual({ reps: '8–12 · 2 RIR', load: null, reason: null });
  });

  it('shows warm-ups and holds from the plan alone', () => {
    expect(setTarget(set({ warmup: true }), plan({ warmup: true, rir: null }), barbell, 'kg', true).reps).toBe('8–12');
    const hold = { ...barbell, trackingMode: 'duration' as const };
    expect(setTarget(set(), plan({ repMin: 45, repMax: 45 }), hold, 'kg', true)).toEqual({ reps: '45 s', load: null, reason: null });
  });

  it('marks added and assisted loads and shows none for bodyweight', () => {
    expect(setTarget(set({ suggestion: suggestion({ suggestedLoadKg: 10 }) }), plan(),
      { name: 'Weighted pull-up', loadModel: 'full_bodyweight' }, 'kg', true).load).toBe('+10 kg');
    expect(setTarget(set({ suggestion: suggestion({ suggestedLoadKg: 20 }) }), plan(),
      { name: 'Assisted pull-up', loadModel: 'full_bodyweight' }, 'kg', true).load).toBe('−20 kg');
    expect(setTarget(set({ suggestion: suggestion({ suggestedLoadKg: 0 }) }), plan(),
      { name: 'Pull-up', loadModel: 'full_bodyweight' }, 'kg', true).load).toBeNull();
  });

  it('shows pounds and drops the effort when RIR is not tracked', () => {
    expect(setTarget(set(), plan(), barbell, 'lb', false)).toMatchObject({ reps: '9', load: '110.23 lb' });
  });

  it('leaves out an effort the program never states', () => {
    expect(setTarget(set(), plan({ rir: null, targetRpe: null }), barbell, 'kg', true).reps).toBe('9');
  });

  it('shows a technique set at the straight-set load its suggestion follows', () => {
    const technique = suggestion({ suggestedLoadKg: 50, suggestedReps: 8, reason: 'Technique set: start with your straight-set load.' });
    expect(setTarget(set({ suggestion: technique }), plan({ notes: 'Myo-reps' }), barbell, 'kg', true))
      .toMatchObject({ reps: '8 · 2 RIR', load: '50 kg' });
  });
});
