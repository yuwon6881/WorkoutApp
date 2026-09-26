import { describe, expect, it } from 'vitest';
import type { DraftSet } from '../types';
import { applySetType, getSetType, hasOpenReps, partialTechniqueLabel } from './importSetTypes';

const set = (patch: Partial<DraftSet>): DraftSet => ({
  repMin: 1, repMax: 1, targetRpe: 10, restSeconds: 180, tempo: null, loadText: null, notes: null,
  repsSource: 'inferred', rpeSource: 'extracted', restSource: 'extracted', repsText: null, restText: null,
  rir: '0', warmup: false, ...patch
} as DraftSet);

describe('importSetTypes', () => {
  it('treats a tagged AMRAP row with no printed count as having no rep target', () => {
    const amrap = set({ repsText: 'AMRAP', notes: 'To failure / AMRAP' });

    expect(getSetType(amrap)).toBe('amrap');
    expect(hasOpenReps(amrap)).toBe(true);
    expect(hasOpenReps(set({ repsText: '8-10', notes: 'To failure / AMRAP' }))).toBe(false);
  });

  it('asks for a rep target again when an open AMRAP set becomes a normal set', () => {
    const amrap = set({ repsText: 'AMRAP', notes: 'To failure / AMRAP' });

    expect(applySetType(amrap, 'normal')).toMatchObject({ repsText: null, notes: null });
    expect(applySetType(set({ repsText: '8-10' }), 'normal')).not.toHaveProperty('repsText');
  });

  it.each([
    ['partial reps', 'partials', 'Partial reps'],
    ['Lengthened Partials (Extend Set)', 'lengthenedPartials', 'Lengthened partials (Extend Set)'],
    ['Long-length Partials (on all reps of the last set)', 'lengthenedPartials', 'Lengthened partials (on all reps of the last set)'],
    ['Integrated Partials (All Sets)', 'integratedPartials', 'Integrated partials (All Sets)']
  ] as const)('recognizes the printed partial technique %s', (notes, type, label) => {
    const prescription = set({ notes });

    expect(getSetType(prescription)).toBe(type);
    expect(partialTechniqueLabel(prescription)).toBe(label);
  });

  it('lets review choose a partial technique without changing the rep prescription', () => {
    const prescription = set({ repMin: 8, repMax: 10, repsText: '8-10', notes: 'Lengthened Partials (Extend Set)' });

    expect({ ...prescription, ...applySetType(prescription, 'integratedPartials') }).toMatchObject({
      notes: 'Integrated partials', repsText: '8-10', repMin: 8, repMax: 10
    });
    expect(applySetType(prescription, 'normal').notes).toBeNull();
  });
});
