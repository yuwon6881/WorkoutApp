import { describe, expect, it } from 'vitest';
import { weightBasisDescription, weightUnit } from './weightBasis';
import { loadColumnLabel, loadFieldName } from './resistanceVariant';

describe('exercise weight basis', () => {
  it('labels per-side loads in either display unit without changing the amount', () => {
    expect(weightUnit('kg', { weightBasis: 'per_side' })).toBe('kg/side');
    expect(weightUnit('lb', { weightBasis: 'per_side' })).toBe('lb/side');
    expect(loadColumnLabel('external', 'kg', { weightBasis: 'per_side' })).toBe('kg/side');
    expect(loadFieldName('external', { weightBasis: 'per_side' })).toBe('weight per side');
  });

  it('keeps total and legacy loads and bodyweight semantics intact', () => {
    expect(weightUnit('kg', {})).toBe('kg');
    expect(loadColumnLabel('external', 'lb', { weightBasis: 'total' })).toBe('lb');
    expect(loadColumnLabel('assistance', 'kg')).toBe('Assist');
    expect(loadColumnLabel('bodyweight', 'kg')).toBe('BW');
    expect(weightBasisDescription({ weightBasis: 'per_side' })).toContain('without adding left and right');
  });
});
