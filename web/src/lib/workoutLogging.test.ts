import { describe, expect, it } from 'vitest';
import type { LoggedSet, Session, SessionExercise } from '../types';
import { blankPrescription } from './workoutDraft';
import { advanceTarget, nextLog, nextUpText } from './workoutLogging';

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

describe('the next set to log', () => {
  it('names the first open set with its load and reps', () => {
    const draft = workout([exercise('a', 'Bench press', [set('a1', { done: true }), set('a2', { weightKg: 62.5 })])]);
    expect(nextLog(draft, 0, 'kg')).toMatchObject({
      setIndex: 1, label: 'Log set 2', detail: '62.5 kg × 8', ariaLabel: 'Log Bench press set 2'
    });
  });

  it('is absent once every set of the exercise is logged', () => {
    expect(nextLog(workout([exercise('a', 'Bench', [set('a1', { done: true })])]), 0, 'kg')).toBeNull();
  });
});

describe('moving on after a set', () => {
  it('stays on an exercise until its last set, then moves to the next one', () => {
    const draft = workout([exercise('a', 'Bench', [set('a1', { done: true }), set('a2')]), exercise('b', 'Row', [set('b1')])]);
    expect(advanceTarget(draft, 0, 0)).toBeNull();
    const finished = workout([exercise('a', 'Bench', [set('a1', { done: true }), set('a2', { done: true })]), exercise('b', 'Row', [set('b1')])]);
    expect(advanceTarget(finished, 0, 1)).toBe(1);
  });

  it('alternates between superset partners', () => {
    const draft = workout([
      exercise('a', 'Curl', [set('a1', { done: true }), set('a2')], 'A1'),
      exercise('b', 'Pushdown', [set('b1'), set('b2')], 'A2')
    ]);
    expect(advanceTarget(draft, 0, 0)).toBe(1);
  });

  it('describes what comes next for the rest bar', () => {
    const draft = workout([exercise('a', 'Bench', [set('a1', { done: true })]), exercise('b', 'Row', [set('b1', { weightKg: 50, reps: 10 })])]);
    expect(nextUpText(draft, 0, 'kg')).toBe('Row · set 1 · 50 kg × 10');
  });
});
