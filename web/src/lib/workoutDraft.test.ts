import { describe, expect, it } from 'vitest';
import type { LoggedSet, Session, SessionExercise } from '../types';
import { blankPrescription, effortPatch, effortValue, exerciseListChanged, nextPendingSet, setNumberLabel, indexAfterRemoval, withSetAdded, withSetRemoved, withServerFlags, withSetRestored, withSetsRestored } from './workoutDraft';

function loggedSet(id: string, patch: Partial<LoggedSet> = {}): LoggedSet {
  return { id, position: 0, weightKg: 60, reps: 8, rpe: null, done: false, warmup: false, resistanceMode: 'external', ...patch };
}

function exercise(id: string, sets: LoggedSet[]): SessionExercise {
  return {
    id, exerciseId: `catalog-${id}`, name: `Exercise ${id}`, position: 0, note: '',
    prescription: sets.map(() => blankPrescription()), sets, sequenceGroup: '', substitutions: [], progression: null
  };
}

const session: Session = {
  id: 'workout-1', templateId: null, programId: null, name: 'Workout', note: '', active: true,
  startedAt: '2026-09-26T08:00:00.000Z', finishedAt: null, revision: 3, volumeKg: null, completedSets: 0, warmupSets: 0,
  exercises: [exercise('a', [loggedSet('a1', { done: true }), loggedSet('a2'), loggedSet('a3')]), exercise('b', [loggedSet('b1')])]
};

describe('exercise-list changes', () => {
  it('treats adding or removing a set as an offline-safe change', () => {
    expect(exerciseListChanged(session, withSetAdded(session, 0))).toBe(false);
    expect(exerciseListChanged(session, withSetRemoved(session, 0, 1)!.next)).toBe(false);
  });

  it('still reports adding, removing, or replacing an exercise', () => {
    expect(exerciseListChanged(session, { ...session, exercises: session.exercises.slice(0, 1) })).toBe(true);
    const replaced = { ...session.exercises[1], exerciseId: 'catalog-other', name: 'Other' };
    expect(exerciseListChanged(session, { ...session, exercises: [session.exercises[0], replaced] })).toBe(true);
  });
});

describe('set removal and undo', () => {
  it('restores the same set, identity and logged values, at its original position', () => {
    const removal = withSetRemoved(session, 0, 0)!;
    expect(removal.next.exercises[0].sets.map(set => set.id)).toEqual(['a2', 'a3']);
    expect(removal.next.exercises[0].prescription).toHaveLength(2);

    const restored = withSetRestored(removal.next, removal.removed)!;
    expect(restored.exercises[0].sets.map(set => set.id)).toEqual(['a1', 'a2', 'a3']);
    expect(restored.exercises[0].sets[0]).toEqual(session.exercises[0].sets[0]);
    expect(restored.exercises[0].prescription).toHaveLength(3);
  });

  it('never removes the only set of an exercise', () => {
    expect(withSetRemoved(session, 1, 0)).toBeNull();
  });

  it('restores a quick run of removals together, each where it was', () => {
    const first = withSetRemoved(session, 0, 0)!;
    const second = withSetRemoved(first.next, 0, 0)!;
    expect(second.next.exercises[0].sets.map(set => set.id)).toEqual(['a3']);
    const restored = withSetsRestored(second.next, [first.removed, second.removed])!;
    expect(restored.exercises[0].sets.map(set => set.id)).toEqual(['a1', 'a2', 'a3']);
    expect(restored.exercises[0].prescription).toHaveLength(3);
  });

  it('does not restore twice or into an exercise that is gone', () => {
    const removal = withSetRemoved(session, 0, 2)!;
    const restored = withSetRestored(removal.next, removal.removed)!;
    expect(withSetRestored(restored, removal.removed)).toBeNull();
    expect(withSetRestored({ ...removal.next, exercises: [removal.next.exercises[1]] }, removal.removed)).toBeNull();
  });
});

describe('adding a set', () => {
  it('repeats a timed prescription without copying recorded time or inventing effort', () => {
    const timed = exercise('hold', [loggedSet('hold-1', { reps: null, durationSeconds: 45 })]);
    timed.trackingMode = 'duration';
    timed.prescription = [{ ...blankPrescription(), repMin: null, repMax: null, repsText: '45 sec', targetRpe: null }];
    const added = withSetAdded({ ...session, exercises: [timed] }, 0).exercises[0];
    expect(added.prescription[1]).toMatchObject({ repMin: null, repMax: null, repsText: '45 sec', targetRpe: null, rir: null });
    expect(added.sets[1]).toMatchObject({ reps: null, durationSeconds: null, done: false });
  });

  it('does not invent a target for an unplanned timed set', () => {
    const timed = { ...exercise('hold', []), trackingMode: 'duration' as const, prescription: [] };
    const added = withSetAdded({ ...session, exercises: [timed] }, 0).exercises[0];
    expect(added.prescription[0]).toMatchObject({ repMin: null, repMax: null, targetRpe: null, repsText: null });
  });

  it('keeps the program reserve target on the added set', () => {
    const planned = exercise('rir', [loggedSet('rir-1')]);
    planned.prescription = [{ ...blankPrescription(), rir: '1-2' }];
    const added = withSetAdded({ ...session, exercises: [planned] }, 0).exercises[0];
    expect(added.prescription[1].rir).toBe('1-2');
  });

  it('does not carry a warm-up dash onto a working set', () => {
    const warm = exercise('warm', [loggedSet('warm-1', { warmup: true })]);
    warm.prescription = [{ ...blankPrescription(), warmup: true, rir: '-' }];
    const added = withSetAdded({ ...session, exercises: [warm] }, 0).exercises[0];
    expect(added.prescription[1]).toMatchObject({ warmup: false, rir: null });
  });

  it('repeats the previous load and reps as an unlogged set', () => {
    const added = withSetAdded(session, 0).exercises[0];
    expect(added.sets).toHaveLength(4);
    expect(added.sets[3]).toMatchObject({ weightKg: 60, reps: 8, rpe: null, done: false, warmup: false });
    expect(added.prescription).toHaveLength(4);
  });
});

describe('set numbering', () => {
  it('counts warm-ups and working sets separately', () => {
    const withWarmup = exercise('w', [loggedSet('w1', { warmup: true }), loggedSet('w2'), loggedSet('w3')]);
    expect(setNumberLabel(withWarmup, 0)).toEqual({ label: 'W1', warmup: true });
    expect(setNumberLabel(withWarmup, 1)).toEqual({ label: '1', warmup: false });
    expect(setNumberLabel(withWarmup, 2)).toEqual({ label: '2', warmup: false });
  });

  it('finds the first set still to log', () => {
    expect(nextPendingSet(session.exercises[0])).toBe(1);
    expect(nextPendingSet(undefined)).toBe(-1);
  });
});

describe('effort values', () => {
  it('round-trips RIR through the stored RPE and RIR fields', () => {
    expect(effortPatch(2)).toEqual({ rpe: 8, rir: '2' });
    expect(effortPatch(5)).toEqual({ rpe: null, rir: '5+' });
    expect(effortPatch(null)).toEqual({ rpe: null, rir: null });
    expect(effortValue(loggedSet('e', effortPatch(2)))).toBe(2);
    expect(effortValue(loggedSet('e', effortPatch(5)))).toBe(5);
    expect(effortValue(loggedSet('e'))).toBeNull();
  });
});

describe('withServerFlags', () => {
  const session = (canRestore: boolean, reps = 8): Session => ({
    id: 'workout', templateId: 'day', programId: null, name: 'Push', note: '', active: true, startedAt: '2026-10-04T08:00:00Z',
    finishedAt: null, revision: 1, volumeKg: null, completedSets: 0, warmupSets: 0,
    exercises: [{ id: 'bench', exerciseId: 'bench-id', name: 'Bench', position: 0, note: '', prescription: [], sequenceGroup: '',
      substitutions: [], progression: null, canRestore,
      sets: [{ id: 'set', position: 0, weightKg: 60, reps, rpe: null, done: false, warmup: false }] }]
  });

  it('shows Restore default once the server reports a changed plan, keeping local values', () => {
    const merged = withServerFlags(session(false, 10), session(true, 8));

    expect(merged.exercises[0].canRestore).toBe(true);
    expect(merged.exercises[0].sets[0].reps).toBe(10);
  });

  it('returns the same draft when nothing changed', () => {
    const draft = session(false);
    expect(withServerFlags(draft, session(false))).toBe(draft);
  });
});

describe('exercise removal navigation', () => {
  it('keeps the open exercise unless it was the last one', () => {
    expect(indexAfterRemoval(0, 2)).toBe(0);
    expect(indexAfterRemoval(1, 2)).toBe(1);
    expect(indexAfterRemoval(2, 2)).toBe(1);
    expect(indexAfterRemoval(3, 0)).toBe(0);
  });
});
