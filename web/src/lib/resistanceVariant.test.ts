import { describe, expect, it } from 'vitest';
import type { Exercise, LoggedSet, SessionExercise } from '../types';
import { loadColumnLabel, loadEntryFor, resistanceModeFor } from './resistanceVariant';
import { addedSessionExercise, blankPrescription, indexAfterMove, loadIsEditable, withExerciseMoved } from './workoutDraft';
import { setSummary } from './workoutLogging';
import { isTimedExercise } from './setDuration';
import { previewOrder } from '../components/useStripReorder';

const named = (name: string, loadModel: SessionExercise['loadModel'] = 'full_bodyweight') => ({ name, loadModel });

function sessionExercise(name: string, loadModel: SessionExercise['loadModel'], set: Partial<LoggedSet>): SessionExercise {
  return {
    id: name, exerciseId: name, name, position: 0, note: '', loadModel, prescription: [blankPrescription()],
    sets: [{ id: `${name}-1`, position: 0, weightKg: 10, reps: 8, rpe: null, done: true, warmup: false, ...set }],
    sequenceGroup: '', substitutions: [], progression: null
  };
}

describe('bodyweight variants', () => {
  it('takes the resistance mode from the exercise name, never a per-set choice', () => {
    expect(resistanceModeFor('full_bodyweight', 'Weighted Pull-Up')).toBe('added');
    expect(resistanceModeFor('full_bodyweight', 'Assisted Dip')).toBe('assistance');
    expect(resistanceModeFor('full_bodyweight', 'Pull-Up')).toBe('bodyweight');
    expect(resistanceModeFor('external', 'Assisted Pull-Up')).toBe('external');
    expect(resistanceModeFor('reps_only', 'Weighted Crunch')).toBe('reps_only');
  });

  it('only lets a weighted or assisted variant enter a load', () => {
    expect(loadIsEditable(named('Weighted Pull-Up'))).toBe(true);
    expect(loadIsEditable(named('Assisted Chin-Up'))).toBe(true);
    expect(loadIsEditable(named('Pull-Up'))).toBe(false);
    expect(loadIsEditable(named('Bench Press', 'external'))).toBe(true);
  });

  it('marks an assisted machine as assistance even though it is logged as an external load', () => {
    expect(loadEntryFor(named('Assisted Pull-Up', 'external'))).toBe('assistance');
    expect(loadColumnLabel(loadEntryFor(named('Assisted Pull-Up', 'external')), 'kg')).toBe('Assist');
    expect(loadColumnLabel(loadEntryFor(named('Weighted Dip')), 'kg')).toBe('+KG');
    expect(loadColumnLabel(loadEntryFor(named('Dip')), 'kg')).toBe('BW');
  });

  it('summarises each variant so the number cannot be read as the wrong kind of weight', () => {
    const weighted = sessionExercise('Weighted Pull-Up', 'full_bodyweight', { resistanceMode: 'bodyweight' });
    expect(setSummary(weighted, weighted.sets[0], 'kg')).toBe('+10 kg × 8');
    const assisted = sessionExercise('Assisted Pull-Up', 'external', {});
    expect(setSummary(assisted, assisted.sets[0], 'kg')).toBe('10 kg assist × 8');
    const plain = sessionExercise('Pull-Up', 'full_bodyweight', { resistanceMode: 'added' });
    expect(setSummary(plain, plain.sets[0], 'kg')).toBe('BW × 8');
  });
});

describe('an exercise added during a workout', () => {
  const plank: Exercise = {
    id: 'plank', slug: 'plank', name: 'Plank', trackingMode: 'duration', muscle: 'Core', equipment: 'Bodyweight',
    cue: '', aliases: [], loadStepKg: 2.5, loadModel: 'full_bodyweight'
  };

  it('keeps its catalog tracking mode and invents no target', () => {
    const added = addedSessionExercise(plank, 3);
    expect(isTimedExercise(added)).toBe(true);
    expect(added.position).toBe(3);
    expect(added.prescription[0]).toMatchObject({ repMin: null, repMax: null, targetRpe: null });
    expect(added.sets[0]).toMatchObject({ weightKg: null, reps: null, resistanceMode: 'bodyweight' });
  });
});

describe('reordering exercises', () => {
  const base = addedSessionExercise({ id: 'x', slug: 'x', name: 'X', muscle: '', equipment: '', cue: '', aliases: [], loadStepKg: 2.5 }, 0);
  const draft = {
    id: 'w', templateId: null, programId: null, name: 'W', note: '', active: true, startedAt: '2026-10-04T08:00:00.000Z',
    finishedAt: null, revision: 1, volumeKg: null, completedSets: 0, warmupSets: 0,
    exercises: ['a', 'b', 'c', 'd'].map((id, position) => ({ ...base, id, name: id, position }))
  };

  it('moves one exercise and renumbers the rest', () => {
    const moved = withExerciseMoved(draft, 0, 2);
    expect(moved.exercises.map(exercise => exercise.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(moved.exercises.map(exercise => exercise.position)).toEqual([0, 1, 2, 3]);
    expect(withExerciseMoved(draft, 1, 1)).toBe(draft);
    expect(withExerciseMoved(draft, 0, 9)).toBe(draft);
  });

  it('keeps the open exercise open', () => {
    expect(indexAfterMove(0, 0, 2)).toBe(2);
    expect(indexAfterMove(2, 0, 3)).toBe(1);
    expect(indexAfterMove(1, 3, 0)).toBe(2);
    expect(indexAfterMove(3, 0, 1)).toBe(3);
  });

  it('previews the held exercise in the slot it would land in', () => {
    expect(previewOrder(4, null)).toEqual([0, 1, 2, 3]);
    expect(previewOrder(4, { from: 3, to: 1 })).toEqual([0, 3, 1, 2]);
  });
});
