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

  it('offers a warm-up on any working set and a working type on any warm-up', () => {
    const item = exercise([true, false, false]);
    expect(allowedSetTypes(item, 1)).toContain('warmup');
    expect(allowedSetTypes(item, 2)).toContain('warmup');
    expect(allowedSetTypes(exercise([true, true, false]), 0)).toContain('normal');
    expect(allowedSetTypes(exercise([true, true, false]), 1)).toContain('myoreps');
  });

  it('holds a warm-up to the leading block when a logged set is in the way', () => {
    const item = exercise([false, false]);
    item.sets[0].done = true;
    expect(allowedSetTypes(item, 1)).not.toContain('warmup');
    expect(withSetType(draft(item), 0, 1, 'warmup')).toEqual(draft(item));
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

  // Three warm-ups, the real set (with its progression target), then a set added below it.
  const rampWithAddedSet = () => {
    const item = exercise([true, true, true, false, false]);
    item.sets[3] = { ...item.sets[3], weightKg: 100, reps: 5, suggestion: { suggestedLoadKg: 100, suggestedReps: 5 } as LoggedSet['suggestion'] };
    item.prescription[3] = plan({ repMin: 4, repMax: 6, rir: '2' });
    item.sets[4] = { ...item.sets[4], weightKg: 100, reps: 5, rpe: null };
    item.prescription[4] = plan({ repMin: 4, repMax: 6, rir: '2' });
    return item;
  };

  it('keeps the real set and its target last when the first working set becomes a warm-up', () => {
    const item = rampWithAddedSet();
    const [realId, addedId] = [item.sets[3].id, item.sets[4].id];
    const next = withSetType(draft(item), 0, 3, 'warmup').exercises[0];
    expect(next.sets.map(s => s.warmup)).toEqual([true, true, true, true, false]);
    expect(next.sets[3].id).toBe(addedId);
    expect(next.sets[4].id).toBe(realId);
    expect(next.sets[4].suggestion).toMatchObject({ suggestedLoadKg: 100 });
    expect(next.prescription[4]).toMatchObject({ warmup: false, repMin: 4, rir: '2' });
    expect(next.prescription[3].warmup).toBe(true);
    expect(next.sets.map(s => s.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('moves a set added below the working sets up to the end of the warm-ups', () => {
    const item = rampWithAddedSet();
    const realId = item.sets[3].id;
    const next = withSetType(draft(item), 0, 4, 'warmup').exercises[0];
    expect(next.sets.map(s => s.warmup)).toEqual([true, true, true, true, false]);
    expect(next.sets[4].id).toBe(realId);
    expect(next.prescription[4]).toMatchObject({ warmup: false, repMin: 4, rir: '2' });
  });

  it('drops a warm-up to the start of the working sets when it becomes a working set', () => {
    const item = exercise([true, true, false]);
    const firstId = item.sets[0].id;
    const next = withSetType(draft(item), 0, 0, 'normal').exercises[0];
    expect(next.sets.map(s => s.warmup)).toEqual([true, false, false]);
    expect(next.sets[1].id).toBe(firstId);
    expect(next.sets.map(s => s.position)).toEqual([0, 1, 2]);
  });

  it('does not move a set when a technique changes between working sets', () => {
    const item = exercise([true, false, false]);
    const ids = item.sets.map(s => s.id);
    const next = withSetType(draft(item), 0, 2, 'dropset').exercises[0];
    expect(next.sets.map(s => s.id)).toEqual(ids);
    expect(next.prescription[2].notes).toBe('Dropset');
  });

  it('leaves the program plan as it was when a set is switched to another type and back', () => {
    const printed = plan({ targetRpe: null, rir: '2', rpeSource: 'extracted', notes: null });
    const item = exercise([true, false, false]);
    item.prescription = item.prescription.map((p, i) => i === 0 ? p : { ...printed });
    const before = item.prescription.map(p => ({ ...p }));
    const there = withSetType(draft(item), 0, 2, 'warmup');
    // The set joined the end of the warm-ups (index 1), so that is where it is switched back from.
    const back = withSetType(there, 0, 1, 'normal').exercises[0];
    expect(back.prescription).toEqual(before);
    expect(withSetType(withSetType(draft(item), 0, 2, 'myoreps'), 0, 2, 'normal').exercises[0].prescription).toEqual(before);
  });

  it('keeps the printed effort target on a set that becomes a warm-up', () => {
    const item = exercise([false]);
    item.prescription[0] = plan({ targetRpe: 8, rir: '2', rpeSource: 'extracted' });
    const next = withSetType(draft(item), 0, 0, 'warmup').exercises[0];
    expect(next.prescription[0]).toMatchObject({ warmup: true, targetRpe: 8, rir: '2', rpeSource: 'extracted' });
  });

  it('turns the only working set into a warm-up in place', () => {
    const base = draft(exercise([true, false]));
    const next = withSetType(base, 0, 1, 'warmup').exercises[0];
    expect(next.sets.map(s => s.warmup)).toEqual([true, true]);
    expect(next.sets[1].id).toBe(base.exercises[0].sets[1].id);
  });

  it('gives a set without its own prescription one before changing it', () => {
    const item = { ...exercise([false, false]), prescription: [plan()] };
    const next = withSetType(draft(item), 0, 1, 'dropset').exercises[0];
    expect(next.prescription).toHaveLength(2);
    expect(next.prescription[1].notes).toBe('Dropset');
  });
});
