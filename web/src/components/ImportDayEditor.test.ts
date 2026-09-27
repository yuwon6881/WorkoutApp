import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DraftWorkout, Exercise } from '../types';
import { DayEditor } from './ImportDayEditor';

function makeExercise(override: Partial<Exercise> & { id: string; name: string; muscle: string }): Exercise {
  return {
    slug: override.name.toLowerCase().replace(/\s+/g, '-'),
    cue: '',
    loadStepKg: 2.5,
    secondaryMuscles: [],
    category: 'Free Weights',
    equipment: 'Barbell',
    loadModel: 'external',
    isCustom: false,
    aliases: [],
    ...override
  };
}

function renderEditor(warmup = false) {
  const day: DraftWorkout = {
    lineId: 'day-line', week: 1, name: 'Week 1 Upper', focus: null, notes: null,
    exercises: [{
      lineId: 'exercise-line', sourceName: 'Barbell bench press', exerciseId: 'bench-id', notes: null,
      sequenceGroup: '', substitutions: [], sets: [{
        repMin: 6, repMax: 6, targetRpe: warmup ? 8 : null, restSeconds: 120, tempo: null,
        loadText: '70–75% 1RM', notes: null, repsSource: 'extracted', rpeSource: 'inferred',
        restSource: 'extracted', repsText: '6/6', restText: '2 min', rir: warmup ? '2' : null, warmup, sourcePage: 3
      }]
    }],
    block: 'Block 1', phase: 'Base', phaseWeek: 1, isRestDay: false, sourcePage: 3
  };

  return renderToStaticMarkup(createElement(DayEditor, {
    day, exercises: [], onChange: async () => {}, getRepRangeMemory: () => new Map()
  }));
}

describe('PDF import set review fields', () => {
  it('shows the four editable prescription fields without source-value inputs', () => {
    const markup = renderEditor();

    expect(markup).toContain('data-import-field="repMin"');
    expect(markup).toContain('data-import-field="repMax"');
    expect(markup).toContain('data-import-field="targetRpe"');
    expect(markup).toContain('data-import-field="rest"');
    expect(markup).not.toContain('Source reps (verbatim)');
    expect(markup).not.toContain('Source load');
  });

  it('explains warm-up effort without showing a disabled RIR number', () => {
    const markup = renderEditor(true);

    expect(markup).toContain('No target for warm-ups');
    expect(markup).not.toContain('2 RIR');
    expect(markup).not.toContain('class="rpe-control');
  });

  it('displays target muscle group pills for mapped library exercise with primary and secondary overflow', () => {
    const day: DraftWorkout = {
      lineId: 'day-line', week: 1, name: 'Week 1 Upper', focus: null, notes: null,
      exercises: [{
        lineId: 'exercise-line', sourceName: 'Barbell bench press', exerciseId: 'bench-id', notes: null,
        sequenceGroup: '', substitutions: ['Incline Dumbbell Press'], sets: [{
          repMin: 6, repMax: 6, targetRpe: 8, restSeconds: 120, tempo: null,
          loadText: null, notes: null, repsSource: 'extracted', rpeSource: 'extracted',
          restSource: 'extracted', repsText: '6', restText: '2 min', rir: '2', warmup: false, sourcePage: 1
        }]
      }],
      block: 'Block 1', phase: 'Base', phaseWeek: 1, isRestDay: false, sourcePage: 1
    };

    const exercises: Exercise[] = [
      makeExercise({
        id: 'bench-id', name: 'Barbell bench press', muscle: 'Chest',
        secondaryMuscles: ['Triceps', 'Shoulders']
      }),
      makeExercise({
        id: 'incline-id', name: 'Incline Dumbbell Press', muscle: 'Shoulders',
        secondaryMuscles: ['Chest'], equipment: 'Dumbbell'
      })
    ];

    const markup = renderToStaticMarkup(createElement(DayEditor, {
      day, exercises, onChange: async () => {}, getRepRangeMemory: () => new Map()
    }));

    expect(markup).toContain('import-exercise-muscles');
    expect(markup).toContain('pill pill-accent">Chest</span>');
    expect(markup).toContain('pill pill-muted">Triceps</span>');
    expect(markup).toContain('pill-overflow');
    expect(markup).toContain('+1</span>');
  });

  it('updates target muscle group display when an exercise is substituted', () => {
    const dayBefore: DraftWorkout = {
      lineId: 'day-line', week: 1, name: 'Week 1 Upper', focus: null, notes: null,
      exercises: [{
        lineId: 'exercise-line', sourceName: 'Barbell bench press', exerciseId: 'bench-id', notes: null,
        sequenceGroup: '', substitutions: ['Incline Dumbbell Press'], sets: []
      }],
      block: 'Block 1', phase: 'Base', phaseWeek: 1, isRestDay: false, sourcePage: 1
    };

    const dayAfter: DraftWorkout = {
      lineId: 'day-line', week: 1, name: 'Week 1 Upper', focus: null, notes: null,
      exercises: [{
        lineId: 'exercise-line', sourceName: 'Incline Dumbbell Press', exerciseId: 'incline-id', notes: null,
        sequenceGroup: '', substitutions: ['Barbell bench press'], sets: []
      }],
      block: 'Block 1', phase: 'Base', phaseWeek: 1, isRestDay: false, sourcePage: 1
    };

    const exercises: Exercise[] = [
      makeExercise({
        id: 'bench-id', name: 'Barbell bench press', muscle: 'Chest',
        secondaryMuscles: ['Triceps']
      }),
      makeExercise({
        id: 'incline-id', name: 'Incline Dumbbell Press', muscle: 'Shoulders',
        secondaryMuscles: ['Chest'], equipment: 'Dumbbell'
      })
    ];

    const markupBefore = renderToStaticMarkup(createElement(DayEditor, {
      day: dayBefore, exercises, onChange: async () => {}, getRepRangeMemory: () => new Map()
    }));
    expect(markupBefore).toContain('pill pill-accent">Chest</span>');
    expect(markupBefore).toContain('pill pill-muted">Triceps</span>');

    const markupAfter = renderToStaticMarkup(createElement(DayEditor, {
      day: dayAfter, exercises, onChange: async () => {}, getRepRangeMemory: () => new Map()
    }));
    expect(markupAfter).toContain('pill pill-accent">Shoulders</span>');
    expect(markupAfter).toContain('pill pill-muted">Chest</span>');
  });
});
