import { describe, expect, it } from 'vitest';
import type { DraftExercise, DraftSet } from '../types';
import { useListedEffort } from './importEffortResolution';

const set = (patch: Partial<DraftSet>): DraftSet => ({
  repMin: 10, repMax: 12, targetRpe: 9, rir: '1', notes: 'To failure / AMRAP', warmup: false,
  restSeconds: 90, tempo: null, loadText: null, repsSource: 'inferred', rpeSource: 'inferred',
  restSource: 'inferred', repsText: '10-12', restText: null, ...patch
});
const exercise = (sets: DraftSet[]): DraftExercise => ({
  lineId: 'exercise', sourceName: 'Calf raise', exerciseId: 'calf', notes: 'Push these all very hard. Go to true failure.',
  sets, sequenceGroup: '', substitutions: [], restSeconds: 90
});

describe('useListedEffort', () => {
  it('keeps the source note and effort targets while removing contradictory AMRAP labels', () => {
    const warmup = set({ warmup: true, targetRpe: null, rir: null, notes: null });
    const failure = set({ targetRpe: 10, rir: '0' });
    const result = useListedEffort(exercise([warmup, set({}), failure]))!;
    expect(result.notes).toContain('Use the listed effort targets');
    expect(result.notes).toContain('Go to true failure.');
    expect(result.sets[0]).toEqual(warmup);
    expect(result.sets[1]).toMatchObject({ targetRpe: 9, rir: '1', notes: null });
    expect(result.sets[2]).toEqual(failure);
  });

  it('does not offer a choice when a working set has no usable effort target', () => {
    expect(useListedEffort(exercise([set({ targetRpe: null, rir: null })]))).toBeNull();
  });

  it('does not discard other techniques or exceed the note limit', () => {
    expect(useListedEffort(exercise([set({ notes: 'Tempo set' })]))!.sets[0].notes).toBe('Tempo set');
    expect(useListedEffort({ ...exercise([set({})]), notes: 'x'.repeat(1000) })).toBeNull();
  });
});
