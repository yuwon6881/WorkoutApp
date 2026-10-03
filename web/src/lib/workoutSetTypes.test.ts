import { describe, expect, it } from 'vitest';
import type { LoggedSet, Session, SessionExercise, SetPrescription } from '../types';
import { blankPrescription } from './workoutDraft';
import { allowedSetTypes, sessionSetType, setKind, withSetType } from './workoutSetTypes';

const set = (overrides: Partial<LoggedSet> = {}): LoggedSet => ({
  id: crypto.randomUUID(), position: 0, weightKg: 60, reps: 8, rpe: 8, rir: '2', done: false, warmup: false, ...overrides
});

const plan = (overrides: Partial<SetPrescription> = {}): SetPrescription => ({ ...blankPrescription(), ...overrides });

const exercise = (warmups: boolean[]): SessionExercise => ({
  id: 'e1', exerciseId: 'bench', name: 'Bench press', position: 0, note: '', sequenceGroup: '', substitutions: [], progression: null,
  sets: warmups.map(warmup => set({ warmup })),
  prescription: warmups.map(warmup => plan({ warmup }))
});

const draft = (item: SessionExercise): Session => ({
  id: 's1', templateId: null, programId: null, name: 'Push', note: '', active: true, startedAt: '2026-10-03T10:00:00Z',
  finishedAt: null, revision: 1, exercises: [item], volumeKg: null, completedSets: 0, warmupSets: 0
});

describe('active workout set types', () => {
  it('reads warm-ups from the set or plan and techniques from the plan notes', () => {
    expect(sessionSetType(set({ warmup: true }), plan())).toBe('warmup');
    expect(sessionSetType(set(), plan({ notes: 'Myo-reps' }))).toBe('myoreps');
    expect(sessionSetType(set(), undefined)).toBe('normal');
    expect(setKind(set(), plan({ notes: 'To failure / AMRAP' }))).toBe('straight');
    expect(setKind(set(), plan({ notes: 'Dropset' }))).toBe('dropset');
  });

  it('offers a warm-up only where it keeps warm-ups as a leading block', () => {
    const item = exercise([true, false, false]);
    expect(allowedSetTypes(item, 1)).toContain('warmup');
    expect(allowedSetTypes(item, 2)).not.toContain('warmup');
    expect(allowedSetTypes(exercise([true, true, false]), 0)).toEqual(['warmup']);
    expect(allowedSetTypes(exercise([true, true, false]), 1)).toContain('myoreps');
  });

  it('writes the technique to the plan and the warm-up flag to both, dropping a warm-up effort', () => {
    const base = draft(exercise([false, false]));
    const myo = withSetType(base, 0, 1, 'myoreps').exercises[0];
    expect(myo.prescription[1].notes).toBe('Myo-reps');
    expect(myo.sets[1].warmup).toBe(false);

    const warm = withSetType(base, 0, 0, 'warmup').exercises[0];
    expect(warm.prescription[0].warmup).toBe(true);
    expect(warm.sets[0]).toMatchObject({ warmup: true, rpe: null, rir: null, reps: 8, weightKg: 60 });

    const back = withSetType(withSetType(base, 0, 1, 'myoreps'), 0, 1, 'normal').exercises[0];
    expect(back.prescription[1].notes).toBeNull();
  });

  it('refuses a warm-up after a working set and leaves the draft untouched', () => {
    const base = draft(exercise([false, false]));
    expect(withSetType(base, 0, 1, 'warmup')).toEqual(base);
  });

  it('gives a set without its own prescription one before changing it', () => {
    const item = { ...exercise([false, false]), prescription: [plan()] };
    const next = withSetType(draft(item), 0, 1, 'dropset').exercises[0];
    expect(next.prescription).toHaveLength(2);
    expect(next.prescription[1].notes).toBe('Dropset');
  });
});
