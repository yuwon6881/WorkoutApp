import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LoggedSet, SessionExercise, SetPrescription, SetProgressionSuggestion } from '../types';
import { WorkoutTargetsModal } from './WorkoutTargetsModal';

function plan(warmup: boolean): SetPrescription {
  return {
    repMin: warmup ? 8 : 6, repMax: warmup ? 8 : 8, targetRpe: warmup ? null : 8, restSeconds: 120, tempo: null,
    loadText: null, notes: null, repsText: null, restText: null, rir: warmup ? null : '2', warmup,
    repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted'
  };
}

function suggestion(loadKg: number): SetProgressionSuggestion {
  return {
    suggestedLoadKg: loadKg, suggestedReps: 6, reason: 'Last time was easy.', sourceSessionId: null, sourceDate: null,
    progressionMode: 'load', nutritionContextRevision: null, isBodyweightAdjustment: false, suggestedSystemLoadKg: null,
    resistanceMode: 'external'
  };
}

function set(position: number, warmup: boolean, loadKg: number): LoggedSet {
  return { id: `set-${position}`, position, weightKg: null, reps: null, rpe: null, done: false, warmup, suggestion: suggestion(loadKg) };
}

const exercise: SessionExercise = {
  id: 'bench', exerciseId: 'bench-id', name: 'Bench press', position: 0, note: '',
  prescription: [plan(true), plan(false), plan(false)],
  sets: [set(0, true, 40), set(1, false, 80), set(2, false, 82.5)],
  sequenceGroup: '', substitutions: [], progression: null
};

describe('WorkoutTargetsModal', () => {
  // A leading warm-up is not listed, but it still occupies the first set; each working row must
  // read its own set's suggestion and last result rather than its neighbour's.
  it('keeps each working set lined up with its own suggestion and last result after a warm-up', () => {
    const markup = renderToStaticMarkup(createElement(WorkoutTargetsModal, {
      exercise, unit: 'kg', trackRir: true,
      previousSets: ['W 40 kg × 8', '80 kg × 6', '82.5 kg × 6'],
      onClose: () => undefined
    }));
    expect(markup).not.toContain('Warmup');
    expect(markup).not.toContain('Last: W 40 kg × 8');
    expect(markup.indexOf('Last: 80 kg × 6')).toBeGreaterThan(markup.indexOf('Set 1'));
    expect(markup.indexOf('Last: 82.5 kg × 6')).toBeGreaterThan(markup.indexOf('Set 2'));
    expect(markup).toContain('82.5 kg');
    expect(markup).not.toMatch(/>40 kg</);
  });
});
