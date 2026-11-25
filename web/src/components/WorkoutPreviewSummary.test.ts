import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DraftExercise } from '../types';
import { WorkoutPreviewSummary } from './WorkoutPreviewSummary';
import { WorkoutDaySkeleton } from './WorkoutDaySkeleton';

const set = (warmup: boolean) => ({ warmup }) as DraftExercise['sets'][number];
const exercise = (sets: boolean[]) => ({ sets: sets.map(set) }) as DraftExercise;

function render(minutes: number | null, restRange = false, exercises = [exercise([true, false, false]), exercise([false])]) {
  return renderToStaticMarkup(React.createElement(WorkoutPreviewSummary, { exercises, minutes, restRange }));
}

describe('WorkoutPreviewSummary', () => {
  it('shows time, exercises and working sets as tiles, leaving warm-ups out of the set count', () => {
    const html = render(55);
    expect(html).toContain('~55<small> min</small>');
    expect(html).toContain('<strong>2</strong><span>Exercises</span>');
    expect(html).toContain('<strong>3</strong><span>Working sets</span>');
  });

  it('keeps the rest-range note off screen but in the accessible text and the tile title', () => {
    const html = render(55, true);
    expect(html).toContain('title="At the average of the printed rests; choose Minimal or Maximal in the workout menu"');
    expect(html).toContain('<span class="sr-only">About 55 minutes. At the average of the printed rests');
    expect(render(40)).toContain('At the planned rests');
  });

  it('shows an unknown length as a dash rather than zero', () => {
    const html = render(null, false, []);
    expect(html).toContain('<strong>—</strong><span>Est. time</span>');
    expect(html).not.toContain('sr-only');
  });

  it('is reserved by the start preview skeleton only when asked for', () => {
    const withSummary = renderToStaticMarkup(React.createElement(WorkoutDaySkeleton, { label: 'Loading', summary: true }));
    expect(withSummary.match(/workout-preview-tile"/g)).toHaveLength(3);
    const without = renderToStaticMarkup(React.createElement(WorkoutDaySkeleton, { label: 'Loading' }));
    expect(without).not.toContain('workout-preview-summary');
  });
});
