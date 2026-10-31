import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionExercise } from '../types';
import type { WarmupOffer } from '../lib/workoutWarmups';
import { WorkoutWarmupButton } from './WorkoutWarmupButton';

type CapturedButtonProps = { onClick?: () => void; disabled?: boolean; 'aria-describedby'?: string };
let capturedButton: CapturedButtonProps = {};

vi.mock('./ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => {
    capturedButton = { onClick, disabled, 'aria-describedby': rest['aria-describedby'] };
    return createElement('button', { onClick, disabled, ...rest }, children);
  }
}));

const exercise: SessionExercise = {
  id: 'ex-squat', exerciseId: 'squat-id', name: 'Barbell Back Squat', position: 0, note: '',
  prescription: [], sets: [], sequenceGroup: '', substitutions: [], progression: null
};

const makeOffer = (workingKg: number | null = null, existing = 0, recommended = 3): WarmupOffer => ({
  existing,
  recommended,
  workingKg,
  steps: (count: number) => Array.from({ length: count }, (_, i) => ({ weightKg: 20 + i * 20, reps: 5 }))
});

describe('WorkoutWarmupButton', () => {
  beforeEach(() => {
    capturedButton = {};
  });

  it('does not display warmup guidance permanently when no sets or loads are logged', () => {
    const markup = renderToStaticMarkup(createElement(WorkoutWarmupButton, {
      exercise,
      offer: makeOffer(null),
      unit: 'kg',
      catalogReady: true,
      onApply: () => undefined
    }));

    // Guidance text must NOT show permanently (R1)
    expect(markup).not.toContain('Enter the first working weight to plan warm-ups.');
    expect(markup).not.toContain('warmup-note');

    // Button is enabled, ready to be clicked, and not described by any note
    expect(markup).toContain('Add warm-ups');
    expect(capturedButton.disabled).toBe(false);
    expect(capturedButton['aria-describedby']).toBeUndefined();
  });

  it('renders enabled warmup button without guidance when working load is present', () => {
    const markup = renderToStaticMarkup(createElement(WorkoutWarmupButton, {
      exercise,
      offer: makeOffer(100),
      unit: 'kg',
      catalogReady: true,
      onApply: () => undefined
    }));

    expect(markup).not.toContain('Enter the first working weight to plan warm-ups.');
    expect(markup).not.toContain('warmup-note');
    expect(markup).toContain('Add warm-ups');
    expect(capturedButton.disabled).toBe(false);
    expect(capturedButton['aria-describedby']).toBeUndefined();
  });

  it('renders "Fill warm-ups" label when leading warm-up sets already exist', () => {
    const markup = renderToStaticMarkup(createElement(WorkoutWarmupButton, {
      exercise,
      offer: makeOffer(100, 2, 4),
      unit: 'kg',
      catalogReady: true,
      onApply: () => undefined
    }));

    expect(markup).toContain('Fill warm-ups');
    expect(capturedButton.disabled).toBe(false);
  });

  it('clicking warmup button without sets/loads does not apply warmups', () => {
    const onApply = vi.fn();
    renderToStaticMarkup(createElement(WorkoutWarmupButton, {
      exercise,
      offer: makeOffer(null, 0, 3),
      unit: 'kg',
      catalogReady: true,
      onApply
    }));

    expect(capturedButton.onClick).toBeDefined();
    capturedButton.onClick?.();
    // Warmups cannot be applied without working load
    expect(onApply).not.toHaveBeenCalled();
  });

  it('clicking warmup button with working load calculates and applies warmups', () => {
    const onApply = vi.fn();
    renderToStaticMarkup(createElement(WorkoutWarmupButton, {
      exercise,
      offer: makeOffer(100, 0, 3),
      unit: 'kg',
      catalogReady: true,
      onApply
    }));

    expect(capturedButton.onClick).toBeDefined();
    capturedButton.onClick?.();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([
      { weightKg: 20, reps: 5 },
      { weightKg: 40, reps: 5 },
      { weightKg: 60, reps: 5 }
    ]);
  });
});
