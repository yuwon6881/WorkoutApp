import { describe, expect, it } from 'vitest';
import type { LoggedSet, Session, SessionExercise } from '../types';
import { blankPrescription, effortPatch, effortValue, exerciseListChanged, nextPendingSet, setNumberLabel, withSetAdded, withSetRemoved, withSetRestored } from './workoutDraft';

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

  it('does not restore twice or into an exercise that is gone', () => {
    const removal = withSetRemoved(session, 0, 2)!;
    const restored = withSetRestored(removal.next, removal.removed)!;
    expect(withSetRestored(restored, removal.removed)).toBeNull();
    expect(withSetRestored({ ...removal.next, exercises: [removal.next.exercises[1]] }, removal.removed)).toBeNull();
  });
});

describe('adding a set', () => {
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
