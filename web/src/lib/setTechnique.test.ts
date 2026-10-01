import { describe, expect, it } from 'vitest';
import { setTechnique } from './setTechnique';

describe('setTechnique', () => {
  it('matches the server classification', () => {
    expect(setTechnique({ notes: 'Myo-reps', warmup: false })).toBe('myoreps');
    expect(setTechnique({ notes: 'Long-length partials', warmup: false })).toBe('lengthenedPartials');
    expect(setTechnique({ notes: 'Integrated partials', warmup: false })).toBe('integratedPartials');
    expect(setTechnique({ notes: 'Partial reps (top half)', warmup: false })).toBe('partials');
    expect(setTechnique({ notes: 'DROP SET', warmup: false })).toBe('dropset');
  });

  it('treats failure, plain notes, warm-ups and missing plans as straight sets', () => {
    expect(setTechnique({ notes: 'To failure / AMRAP', warmup: false })).toBeNull();
    expect(setTechnique({ notes: 'Pause at the bottom', warmup: false })).toBeNull();
    expect(setTechnique({ notes: 'Myo-reps', warmup: true })).toBeNull();
    expect(setTechnique(undefined)).toBeNull();
  });
});
