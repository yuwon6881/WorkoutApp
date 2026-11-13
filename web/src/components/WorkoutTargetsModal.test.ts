import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LoggedSet, SessionExercise, SetPrescription, SetProgressionSuggestion } from '../types';
import { WorkoutTargetsView } from './WorkoutTargetsModal';

function plan(warmup: boolean): SetPrescription {
  return {
    repMin: warmup ? 8 : 6, repMax: warmup ? 8 : 8, targetRpe: warmup ? null : 8, restSeconds: 120, tempo: null,
    loadText: null, notes: null, repsText: null, restText: null, rir: warmup ? null : '2', warmup,
    repsSource: 'extracted', rpeSource: 'extracted', restSource: 'extracted'
  };
}

function suggestion(loadKg: number): SetProgressionSuggestion {
  return {
    suggestedLoadKg: loadKg, suggestedReps: 6, reason: 'Last time was easy.', sourceSessionId: null, sourceDate: '2026-10-05T10:00:00Z',
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
  it('does not ask for a one-rep max when the percentage refers to a top set', () => {
    const relative = { ...plan(false), loadText: '60%', notes: 'Percentage of top set' };
    const markup = renderToStaticMarkup(createElement(WorkoutTargetsView, {
      exercise: { ...exercise, prescription: [relative], sets: [set(0, false, 60)] },
      unit: 'kg', trackRir: true, previousSets: [], onClose: () => undefined
    }));
    expect(markup).not.toContain('One-rep max');
    expect(markup).toContain('60% of top set');
  });
  it('shows a percentage alongside a suggested weight', () => {
    const percent = { ...plan(false), loadText: '70%' };
    const markup = renderToStaticMarkup(createElement(WorkoutTargetsView, {
      exercise: { ...exercise, prescription: [percent], sets: [set(0, false, 77.5)] },
      unit: 'kg', trackRir: true, previousSets: [], onClose: () => undefined
    }));
    expect(markup).toContain('70% 1RM');
    expect(markup).toContain('77.5 kg');
    expect(markup).not.toContain('One-rep max');
  });
  // A leading warm-up is not listed, but it still occupies the first set; each working row must
  // read its own set's suggestion and last result rather than its neighbour's.
  it('keeps each working set lined up with its own suggestion and last result after a warm-up', () => {
    const markup = renderToStaticMarkup(createElement(WorkoutTargetsView, {
      exercise, unit: 'kg', trackRir: true,
      previousSets: ['W 40 kg × 8', '80 kg × 6', '82.5 kg × 6'],
      onClose: () => undefined
    }));
    expect(markup).not.toContain('Warmup');
    expect(markup).not.toContain('W 40 kg × 8');
    expect(markup.indexOf('80 kg × 6')).toBeGreaterThan(markup.indexOf('Set 1'));
    expect(markup.indexOf('82.5 kg × 6')).toBeGreaterThan(markup.indexOf('Set 2'));
    expect(markup).toContain('82.5 kg');
    expect(markup).not.toMatch(/>40 kg</);
  });

  it('keeps one Last time row per set whether loading, recorded, missing, or unavailable', () => {
    const render = (previousStatus: 'loading' | 'ready' | 'failed', previousSets: Array<string | null>) =>
      renderToStaticMarkup(createElement(WorkoutTargetsView, {
        exercise, unit: 'kg', trackRir: true, previousSets, previousStatus, onClose: () => undefined
      }));
    const loading = render('loading', []);
    expect(loading.match(/plan-prev-row/g)).toHaveLength(2);
    expect(loading.match(/plan-prev-skeleton/g)).toHaveLength(2);
    expect(loading).toContain('Loading last time');

    const partial = render('ready', [null, '80 kg × 6', null]);
    expect(partial.match(/plan-prev-row/g)).toHaveLength(2);
    expect(partial).toContain('80 kg × 6');
    expect(partial).toContain('No record');

    expect(render('failed', [])).toContain('Unavailable');
  });
});
