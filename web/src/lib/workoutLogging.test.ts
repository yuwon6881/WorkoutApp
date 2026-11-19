import { describe, expect, it } from 'vitest';
import type { LoggedSet, Session, SessionExercise } from '../types';
import { blankPrescription } from './workoutDraft';
import { advanceTarget, nextUpText } from './workoutLogging';
import { notificationSetTarget } from './notificationSetLogging';

function set(id: string, patch: Partial<LoggedSet> = {}): LoggedSet {
  return { id, position: 0, weightKg: 60, reps: 8, rpe: null, done: false, warmup: false, resistanceMode: 'external', ...patch };
}

function exercise(id: string, name: string, sets: LoggedSet[], sequenceGroup = ''): SessionExercise {
  return {
    id, exerciseId: id, name, position: 0, note: '', prescription: sets.map(() => blankPrescription()),
    sets, sequenceGroup, substitutions: [], progression: null
  };
}

function workout(exercises: SessionExercise[]): Session {
  return {
    id: 'w', templateId: null, programId: null, name: 'Day', note: '', active: true, startedAt: '2026-09-26T08:00:00Z',
    finishedAt: null, revision: 1, exercises, volumeKg: null, completedSets: 0, warmupSets: 0
  };
}

describe('notification set logging', () => {
  it('uses the first unlogged set on the open exercise and describes its actual inputs', () => {
    const bench = { ...exercise('a', 'Dumbbell bench', [
      set('a1', { done: true }), set('a2', { rir: '5+' })
    ]), weightBasis: 'per_side' as const };
    const draft = workout([bench, exercise('b', 'Row', [set('b1')])]);
    const target = notificationSetTarget(draft, 0, 'kg', true);
    expect(target).toMatchObject({ exerciseIndex: 0, setIndex: 1,
      title: 'Dumbbell bench · Set 2', values: '60 kg/side × 8 · 5+ RIR' });
    expect(notificationSetTarget(draft, 1, 'kg', true)?.key).not.toBe(target?.key);
    bench.sets[1] = { ...bench.sets[1], weightKg: 60.001 };
    expect(notificationSetTarget(draft, 0, 'kg', true)?.key).not.toBe(target?.key);
  });

  it('withholds the action for paused workouts, timed sets, and a set with missing reps', () => {
    const row = exercise('a', 'Row', [set('a1', { reps: null }), set('a2')]);
    expect(notificationSetTarget(workout([row]), 0, 'kg', true)).toBeNull();
    row.sets[0] = set('a1');
    expect(notificationSetTarget(workout([{ ...row, trackingMode: 'duration' }]), 0, 'kg', true)).toBeNull();
    expect(notificationSetTarget({ ...workout([row]), pausedAt: '2026-09-26T08:10:00Z' }, 0, 'kg', true)).toBeNull();
  });
});

describe('moving on after a set', () => {
  it('stays on an exercise until its last set, then moves to the next one', () => {
    const draft = workout([exercise('a', 'Bench', [set('a1', { done: true }), set('a2')]), exercise('b', 'Row', [set('b1')])]);
    expect(advanceTarget(draft, 0, 0)).toBeNull();
    const finished = workout([exercise('a', 'Bench', [set('a1', { done: true }), set('a2', { done: true })]), exercise('b', 'Row', [set('b1')])]);
    expect(advanceTarget(finished, 0, 1)).toBe(1);
  });

  it('never moves on while a skipped earlier set of the exercise is still to log', () => {
    const skipped = workout([
      exercise('a', 'Bench', [set('a1', { done: true }), set('a2'), set('a3', { done: true })]),
      exercise('b', 'Row', [set('b1')])
    ]);
    expect(advanceTarget(skipped, 0, 2)).toBeNull();
  });

  it('leaves a superset only once every partner is complete', () => {
    const open = workout([
      exercise('a', 'Curl', [set('a1', { done: true }), set('a2', { done: true })], 'A1'),
      exercise('b', 'Pushdown', [set('b1'), set('b2', { done: true })], 'A2'),
      exercise('c', 'Row', [set('c1')])
    ]);
    expect(advanceTarget(open, 0, 1, { nextExercise: true, supersetPartner: false })).toBeNull();
  });

  it('alternates between superset partners', () => {
    const draft = workout([
      exercise('a', 'Curl', [set('a1', { done: true }), set('a2')], 'A1'),
      exercise('b', 'Pushdown', [set('b1'), set('b2')], 'A2')
    ]);
    expect(advanceTarget(draft, 0, 0)).toBe(1);
  });

  it('switches superset jumps and exercise moves separately', () => {
    const superset = workout([
      exercise('a', 'Curl', [set('a1', { done: true }), set('a2')], 'A1'),
      exercise('b', 'Pushdown', [set('b1'), set('b2')], 'A2')
    ]);
    expect(advanceTarget(superset, 0, 0, { nextExercise: true, supersetPartner: false })).toBeNull();
    expect(advanceTarget(superset, 0, 0, { nextExercise: false, supersetPartner: true })).toBe(1);

    const finished = workout([exercise('a', 'Bench', [set('a1', { done: true })]), exercise('b', 'Row', [set('b1')])]);
    expect(advanceTarget(finished, 0, 0, { nextExercise: false, supersetPartner: true })).toBeNull();
    expect(advanceTarget(finished, 0, 0, { nextExercise: true, supersetPartner: false })).toBe(1);
  });

  it('wraps from the last partner back to the first for the next round', () => {
    const draft = workout([
      exercise('a', 'Curl', [set('a1', { done: true }), set('a2')], 'A1'),
      exercise('b', 'Pushdown', [set('b1', { done: true }), set('b2')], 'A2')
    ]);
    expect(advanceTarget(draft, 1, 0, { nextExercise: false, supersetPartner: true })).toBe(0);
    expect(advanceTarget(draft, 1, 0, { nextExercise: true, supersetPartner: false })).toBeNull();
  });

  it('moves past a finished superset as an exercise move, not a partner jump', () => {
    const draft = workout([
      exercise('a', 'Curl', [set('a1', { done: true })], 'A1'),
      exercise('b', 'Pushdown', [set('b1', { done: true })], 'A2'),
      exercise('c', 'Row', [set('c1')])
    ]);
    expect(advanceTarget(draft, 1, 0, { nextExercise: true, supersetPartner: false })).toBe(2);
    expect(advanceTarget(draft, 1, 0, { nextExercise: false, supersetPartner: true })).toBeNull();
  });

  it('describes what comes next for the rest bar', () => {
    const draft = workout([exercise('a', 'Bench', [set('a1', { done: true })]), exercise('b', 'Row', [set('b1', { weightKg: 50, reps: 10 })])]);
    expect(nextUpText(draft, 0, 'kg')).toBe('Row · set 1 · 50 kg × 10');
  });
});
