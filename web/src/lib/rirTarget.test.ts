import { describe, expect, it } from 'vitest';
import type { SetPrescription } from '../types';
import { plannedRirChoices, targetRirChoices } from './rirTarget';

describe('targetRirChoices', () => {
  it('marks a single target, a range, and a floor', () => {
    expect(targetRirChoices('2')).toEqual([2]);
    expect(targetRirChoices('1-2')).toEqual([1, 2]);
    expect(targetRirChoices('0–2')).toEqual([0, 1, 2]);
    expect(targetRirChoices('1+')).toEqual([1]);
    expect(targetRirChoices('5+')).toEqual([5]);
  });

  it('marks nothing it cannot show', () => {
    expect(targetRirChoices(null)).toEqual([]);
    expect(targetRirChoices('')).toEqual([]);
    expect(targetRirChoices('to failure')).toEqual([]);
    expect(targetRirChoices('7')).toEqual([]);
    expect(targetRirChoices('3-1')).toEqual([]);
  });
});

describe('plannedRirChoices', () => {
  const plan = (patch: Partial<SetPrescription>): SetPrescription => ({
    repMin: 8, repMax: 12, targetRpe: null, restSeconds: null, tempo: null, rir: null, warmup: false,
    repsSource: 'user', rpeSource: 'user', restSource: 'user', ...patch
  } as SetPrescription);

  it('reads the printed RIR, then RPE, then the default for a working set', () => {
    expect(plannedRirChoices(plan({ rir: '1-2' }))).toEqual([1, 2]);
    expect(plannedRirChoices(plan({ targetRpe: 9 }))).toEqual([1]);
    expect(plannedRirChoices(plan({}))).toEqual([2]);
    expect(plannedRirChoices(plan({ warmup: true }))).toEqual([]);
    expect(plannedRirChoices(undefined)).toEqual([]);
  });
});
