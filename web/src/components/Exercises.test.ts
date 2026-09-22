import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Exercise } from '../types';
import { ExerciseLibrary, getExerciseCategory } from './Exercises';

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

    const bwIndex = bwMarkup.indexOf('Body Weight');
    const fwIndex = bwMarkup.indexOf('Free Weights');
    const machIndex = bwMarkup.indexOf('Machine');

    expect(bwIndex).toBeLessThan(fwIndex);
    expect(bwIndex).toBeLessThan(machIndex);

    // When swapping a Machine exercise (Machine Chest Press), Machine group comes first
    const machMarkup = renderToStaticMarkup(createElement(ExerciseLibrary, {
      exercises: sampleExercises,
      action: 'swap',
      currentExerciseId: 'ex-chest-press-machine',
      onSelect: () => {}
    }));

    const machIndex2 = machMarkup.indexOf('Machine');
    const fwIndex2 = machMarkup.indexOf('Free Weights');
    const bwIndex2 = machMarkup.indexOf('Body Weight');

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
});
