import { describe, expect, it } from 'vitest';
import { previewLoadLabel, previewLoadsByLine } from './startPreviewLoads';

const set = (weightKg: number | null, resistanceMode = 'external', warmup = false) => ({ position: 0, warmup, weightKg, resistanceMode });

describe('previewLoadLabel', () => {
  it('shows an external load in the account unit', () => {
    expect(previewLoadLabel(set(72.5), 'kg', {})).toBe('72.5 kg');
  });
  it('leaves unknown and bodyweight loads absent rather than zero', () => {
    expect(previewLoadLabel(set(null), 'kg', {})).toBeNull();
    expect(previewLoadLabel(set(0, 'bodyweight'), 'kg', {})).toBeNull();
    expect(previewLoadLabel(set(null, 'reps_only'), 'kg', {})).toBeNull();
  });
  it('names the direction of added and assisted loads', () => {
    expect(previewLoadLabel(set(10, 'added'), 'kg', {})).toBe('+10 kg');
    expect(previewLoadLabel(set(20, 'assistance'), 'kg', {})).toBe('20 kg assist');
  });
});

describe('previewLoadsByLine', () => {
  it('indexes labels by set position', () => {
    const map = previewLoadsByLine([{ templateExerciseId: 'a', sets: [{ ...set(60), position: 1 }] }], new Map(), 'kg');
    expect(map.get('a')?.[1]).toBe('60 kg');
    expect(map.get('a')?.[0]).toBeUndefined();
  });
});
