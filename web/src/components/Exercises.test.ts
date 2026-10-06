import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Exercise } from '../types';
import { getExerciseCategory } from '../lib/exerciseCategory';
import { ExerciseLibrary } from './Exercises';

const sampleExercises: Exercise[] = [
  { id: 'ex-bench', slug: 'bench', name: 'Barbell bench press', muscle: 'Chest', equipment: 'Barbell', cue: '', aliases: [], loadStepKg: 2.5, category: 'Free Weights' },
  { id: 'ex-incline-db', slug: 'incline-db', name: 'Incline Dumbbell Press', muscle: 'Chest', equipment: 'Dumbbell', cue: '', aliases: [], loadStepKg: 2, category: 'Free Weights' },
  { id: 'ex-chest-press-machine', slug: 'chest-press-mach', name: 'Machine Chest Press', muscle: 'Chest', equipment: 'Machine', cue: '', aliases: [], loadStepKg: 5, category: 'Machine' },
  { id: 'ex-pushup', slug: 'pushup', name: 'Push-up', muscle: 'Chest', equipment: 'Bodyweight', cue: '', aliases: [], loadStepKg: 0, loadModel: 'full_bodyweight', category: 'Body Weight' },
  { id: 'ex-cable-crossover', slug: 'cable-crossover', name: 'Cable Crossover', muscle: 'Chest', equipment: 'Cable', cue: '', aliases: [], loadStepKg: 2.5, category: 'Machine' },
  { id: 'ex-squat', slug: 'squat', name: 'Barbell Back Squat', muscle: 'Quads', equipment: 'Barbell', cue: '', aliases: [], loadStepKg: 2.5, category: 'Free Weights' },
  { id: 'ex-leg-press', slug: 'leg-press', name: 'Leg Press', muscle: 'Quads', equipment: 'Machine', cue: '', aliases: [], loadStepKg: 10, category: 'Machine' },
  { id: 'ex-pullup', slug: 'pullup', name: 'Pull-up', muscle: 'Back', equipment: 'Bodyweight', cue: '', aliases: [], loadStepKg: 0, loadModel: 'full_bodyweight', category: 'Body Weight' }
];

describe('getExerciseCategory', () => {
  it('correctly categorizes exercises by equipment, load model, or explicit category', () => {
    expect(getExerciseCategory({ equipment: 'Barbell' })).toBe('Free Weights');
    expect(getExerciseCategory({ equipment: 'Dumbbell' })).toBe('Free Weights');
    expect(getExerciseCategory({ equipment: 'EZ-Bar' })).toBe('Free Weights');
    expect(getExerciseCategory({ equipment: 'Plate' })).toBe('Free Weights');

    expect(getExerciseCategory({ equipment: 'Machine' })).toBe('Machine');
    expect(getExerciseCategory({ equipment: 'Smith Machine' })).toBe('Machine');
    expect(getExerciseCategory({ equipment: 'Cable' })).toBe('Machine');

    expect(getExerciseCategory({ equipment: 'Bodyweight' })).toBe('Body Weight');
    expect(getExerciseCategory({ equipment: 'Band' })).toBe('Body Weight');
    expect(getExerciseCategory({ equipment: '', loadModel: 'full_bodyweight' })).toBe('Body Weight');
    expect(getExerciseCategory({ equipment: '', loadModel: 'reps_only' })).toBe('Body Weight');

    expect(getExerciseCategory({ category: 'Machine', equipment: 'Barbell' })).toBe('Machine');
    expect(getExerciseCategory({ category: 'Body Weight', equipment: 'Dumbbell' })).toBe('Body Weight');
  });
});

describe('ExerciseLibrary UI and grouping', () => {
  it('pins the current exercise at the top with a disabled Current status when swapping', () => {
    const markup = renderToStaticMarkup(createElement(ExerciseLibrary, {
      exercises: sampleExercises,
      action: 'swap',
      currentExerciseId: 'ex-bench',
      onSelect: () => {}
    }));

    // Current exercise section is shown at the top
    expect(markup).toContain('Current exercise');
    expect(markup).toContain('picker-card-current');
    expect(markup).toContain('picker-current-btn');
    expect(markup).toContain('aria-label="Current exercise: Barbell bench press"');
    expect(markup).toContain('disabled=""');

    // Title has title tooltip attribute
    expect(markup).toContain('title="Barbell bench press"');
  });

  it('prioritizes the current exercise category in the group order', () => {
    // When swapping a Body Weight exercise (Push-up), Body Weight group comes first
    const bwMarkup = renderToStaticMarkup(createElement(ExerciseLibrary, {
      exercises: sampleExercises,
      action: 'swap',
      currentExerciseId: 'ex-pushup',
      onSelect: () => {}
    }));

    const bwIndex = bwMarkup.indexOf('aria-label="Body Weight exercises"');
    const fwIndex = bwMarkup.indexOf('aria-label="Free Weights exercises"');
    const machIndex = bwMarkup.indexOf('aria-label="Machine exercises"');

    expect(bwIndex).toBeLessThan(fwIndex);
    expect(bwIndex).toBeLessThan(machIndex);

    // When swapping a Machine exercise (Machine Chest Press), Machine group comes first
    const machMarkup = renderToStaticMarkup(createElement(ExerciseLibrary, {
      exercises: sampleExercises,
      action: 'swap',
      currentExerciseId: 'ex-chest-press-machine',
      onSelect: () => {}
    }));

    const machIndex2 = machMarkup.indexOf('aria-label="Machine exercises"');
    const fwIndex2 = machMarkup.indexOf('aria-label="Free Weights exercises"');
    const bwIndex2 = machMarkup.indexOf('aria-label="Body Weight exercises"');

    expect(machIndex2).toBeLessThan(fwIndex2);
    expect(machIndex2).toBeLessThan(bwIndex2);
  });

  it('draws a relevancy boundary line and Show all exercises button when swapping in All muscles', () => {
    const markup = renderToStaticMarkup(createElement(ExerciseLibrary, {
      exercises: sampleExercises,
      action: 'swap',
      currentExerciseId: 'ex-bench',
      onSelect: () => {}
    }));

    // Similar exercises shown
    expect(markup).toContain('Incline Dumbbell Press');
    expect(markup).toContain('Machine Chest Press');

    // Relevancy boundary divider with Show all exercises button
    expect(markup).toContain('picker-relevancy-boundary');
    expect(markup).toContain('picker-show-all-btn');
    expect(markup).toContain('Show all exercises');

    // By default, unrelated muscles (Quads/Back) are not shown before clicking Show all exercises
    expect(markup).not.toContain('Barbell Back Squat');
    expect(markup).not.toContain('Leg Press');
  });

  it('renders category badges in default library mode', () => {
    const libraryMarkup = renderToStaticMarkup(createElement(ExerciseLibrary, {
      exercises: sampleExercises
    }));

    expect(libraryMarkup).toContain('pill pill-category');
    expect(libraryMarkup).toContain('Free Weights');
    expect(libraryMarkup).toContain('Machine');
    expect(libraryMarkup).toContain('Body Weight');
  });

  it('leaves the category to the group heading on picker cards', () => {
    const pickerMarkup = renderToStaticMarkup(createElement(ExerciseLibrary, {
      exercises: sampleExercises,
      action: 'map',
      onSelect: () => {}
    }));

    expect(pickerMarkup).toContain('category-group-title');
    expect(pickerMarkup).not.toContain('pill pill-category');
  });

  it('renders minor source and category filter selects in both library and picker modes', () => {
    const libraryMarkup = renderToStaticMarkup(createElement(ExerciseLibrary, {
      exercises: sampleExercises
    }));
    expect(libraryMarkup).toContain('aria-label="Filter exercise source"');
    expect(libraryMarkup).toContain('aria-label="Filter exercise category"');
    expect(libraryMarkup).toContain('exercise-minor-filters');

    const pickerMarkup = renderToStaticMarkup(createElement(ExerciseLibrary, {
      exercises: sampleExercises,
      action: 'swap',
      currentExerciseId: 'ex-bench',
      onSelect: () => {}
    }));
    expect(pickerMarkup).toContain('aria-label="Filter exercise source"');
    expect(pickerMarkup).toContain('aria-label="Filter exercise category"');
    expect(pickerMarkup).toContain('exercise-minor-filters');
  });

  it('displays one primary muscle, one secondary muscle, and abstracts remaining muscles to an overflow tag', () => {
    const multiMuscleExercise: Exercise = {
      id: 'ex-bench-multi',
      slug: 'bench-multi',
      name: 'Bench Press Multi',
      muscle: 'Chest',
      secondaryMuscles: ['Triceps', 'Shoulders', 'Core'],
      equipment: 'Barbell',
      cue: '',
      aliases: [],
      loadStepKg: 2.5,
      category: 'Free Weights'
    };

    const markup = renderToStaticMarkup(createElement(ExerciseLibrary, {
      exercises: [multiMuscleExercise]
    }));

    // Primary muscle is displayed
    expect(markup).toContain('Chest');
    // First secondary muscle is displayed
    expect(markup).toContain('Triceps');
    // Remaining 2 secondary muscles are abstracted to +2 with title attribute
    expect(markup).toContain('+2');
    expect(markup).toContain('title="Shoulders, Core"');
    // Direct raw tags for remaining muscles are not rendered as individual pills
    expect(markup).not.toContain('<span class="pill pill-muted">Shoulders</span>');
    expect(markup).not.toContain('<span class="pill pill-muted">Core</span>');
  });
});

describe('defaultChartMetric and ExerciseProgressChart', () => {
  it('falls back to reps when sets were logged without weight so the progress chart does not default to Unavailable', async () => {
    const { defaultChartMetric } = await import('./Exercises');
    const { ExerciseProgressChart } = await import('./ExerciseProgressChart');

    const repsOnlyPoints = [
      {
        date: '2026-10-06',
        sessionId: 'w-1',
        sessionName: 'Full Body 3',
        estimated1RmKg: null,
        loadKg: null,
        volumeKg: null,
        reps: 4,
        partial: true
      }
    ];

    expect(defaultChartMetric(repsOnlyPoints)).toBe('reps');

    const repsMarkup = renderToStaticMarkup(createElement(ExerciseProgressChart, {
      points: [{ key: 'w-1-2026-10-06', date: 'Oct 6, 2026', value: 4 }],
      label: 'Reps progress',
      format: value => value == null ? 'Unavailable' : `${value} reps`
    }));
    expect(repsMarkup).toContain('4 reps');
    expect(repsMarkup).not.toContain('Unavailable');

    const unavailableMetricMarkup = renderToStaticMarkup(createElement(ExerciseProgressChart, {
      points: [{ key: 'w-1-2026-10-06', date: 'Oct 6, 2026', value: null }],
      label: 'Estimated 1RM progress',
      format: value => value == null ? 'Unavailable' : `${value} kg`
    }));
    expect(unavailableMetricMarkup).toContain('No logged weights in this range to calculate estimated 1rm.');
  });
});
