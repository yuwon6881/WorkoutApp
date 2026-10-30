import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SessionExerciseList } from './SessionExerciseList';
import type { SessionExercise } from '../types';

describe('SessionExerciseList', () => {
  const sampleExercise: SessionExercise = {
    id: 'se-1',
    exerciseId: 'ex-squat',
    name: 'Back Squat',
    position: 0,
    note: 'Keep chest up',
    prescription: [],
    sets: [
      { id: 'set-1', position: 0, reps: 6, weightKg: 100, rir: '2', rpe: 8, warmup: false, done: true }
    ],
    sequenceGroup: '',
    substitutions: [],
    progression: null
  };

  it('renders interactive exercise card with role="button" and aria-label when onExercise is supplied', () => {
    const onExercise = vi.fn();
    const markup = renderToStaticMarkup(createElement(SessionExerciseList, {
      exercises: [sampleExercise],
      unit: 'kg',
      loading: false,
      onExercise
    }));

    expect(markup).toContain('session-exercise-action');
    expect(markup).toContain('role="button"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="View Back Squat details"');
    expect(markup).toContain('Back Squat');
    expect(markup).toContain('1 working set');
  });

  it('renders static exercise card without button role when onExercise is not supplied', () => {
    const markup = renderToStaticMarkup(createElement(SessionExerciseList, {
      exercises: [sampleExercise],
      unit: 'kg',
      loading: false
    }));

    expect(markup).not.toContain('session-exercise-action');
    expect(markup).not.toContain('role="button"');
    expect(markup).toContain('Back Squat');
  });

  it('renders pr-set-tag inside session-set-target inline next to set result, keeping only session-set-effort in session-set-tags', () => {
    const exerciseWithPr: SessionExercise = {
      id: 'se-pr',
      exerciseId: 'ex-bench',
      name: 'Bench Press',
      position: 0,
      note: '',
      prescription: [],
      sets: [
        { id: 'set-pr', position: 0, reps: 10, weightKg: 80, rir: '2', rpe: 8, warmup: false, done: true, isPr: true, prKind: 'reps', prReps: 10 },
        { id: 'set-no-pr', position: 1, reps: 8, weightKg: 80, rir: '1', rpe: 9, warmup: false, done: true, isPr: false }
      ],
      sequenceGroup: '',
      substitutions: [],
      progression: null
    };

    const markup = renderToStaticMarkup(createElement(SessionExerciseList, {
      exercises: [exerciseWithPr],
      unit: 'kg',
      loading: false
    }));

    // Check PR row: pr-set-tag must be inside session-set-target directly after setResult strong element
    expect(markup).toMatch(/<span class="session-set-target"><strong>80 kg × 10<\/strong><span class="pill pill-accent pr-set-tag"/);

    // session-set-tags must contain only session-set-effort, NOT pr-set-tag
    expect(markup).toContain('<div class="session-set-tags"><span class="session-set-effort">2 RIR</span></div>');
    expect(markup).toContain('<div class="session-set-tags"><span class="session-set-effort">1 RIR</span></div>');

    // Confirm pr-set-tag is never rendered inside session-set-tags
    expect(markup).not.toMatch(/<div class="session-set-tags">[^<]*<span class="[^"]*pr-set-tag/);
  });

  it('renders pr-set-tag inline next to set result when effort is absent or timed', () => {
    const exercise: SessionExercise = {
      id: 'se-mixed',
      exerciseId: 'ex-plank',
      name: 'Plank',
      position: 0,
      note: '',
      prescription: [],
      sets: [
        { id: 'set-no-effort-pr', position: 0, reps: 5, weightKg: 20, rir: null, rpe: null, warmup: false, done: true, isPr: true, prKind: 'e1rm', estimated1RmKg: 25 },
        { id: 'set-timed-pr', position: 1, reps: 1, weightKg: null, durationSeconds: 60, rir: null, rpe: null, warmup: false, done: true, isPr: true, prKind: 'reps', prReps: 1 }
      ],
      sequenceGroup: '',
      substitutions: [],
      progression: null
    };

    const markup = renderToStaticMarkup(createElement(SessionExerciseList, {
      exercises: [exercise],
      unit: 'kg',
      loading: false
    }));

    // PR tag is in session-set-target even when no effort is logged
    expect(markup).toMatch(/<span class="session-set-target"><strong>20 kg × 5<\/strong><span class="pill pill-accent pr-set-tag"/);

    // Timed PR set has timer icon and PR tag inline next to duration
    expect(markup).toContain('session-set-timer-icon');
    expect(markup).toMatch(/<span class="session-set-target">.+session-set-timer-icon.+<strong>1:00<\/strong><span class="pill pill-accent pr-set-tag"/);

    // session-set-tags is empty when no effort is present
    expect(markup).toContain('<div class="session-set-tags"></div>');
    expect(markup).not.toContain('session-set-effort');
  });
});
