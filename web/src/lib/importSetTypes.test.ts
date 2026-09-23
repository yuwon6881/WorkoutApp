import { describe, expect, it } from 'vitest';
import type { DraftSet } from '../types';
import { applySetType, getSetType, hasOpenReps } from './importSetTypes';

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
});
