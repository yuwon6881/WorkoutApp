import { describe, expect, it } from 'vitest';
import type { DraftWorkout, ImportDraft } from '../types';
import { changedDraftDays } from './importDraftDiff';

function day(lineId: string, rest: number | null = null): DraftWorkout {
  return {
    lineId, week: 1, name: lineId, focus: null, notes: null, block: null, phase: null, phaseWeek: 1, isRestDay: false,
    exercises: [{ lineId: `${lineId}-ex`, sourceName: 'Bench press', exerciseId: null, notes: null, sets: [], sequenceGroup: '', substitutions: [], restSeconds: rest }]
  };
}

const draft = (...workouts: DraftWorkout[]): ImportDraft => ({ programName: 'Block', workouts });

describe('changed draft days', () => {
  it('returns only the days whose exercises changed', () => {
    const current = draft(day('a'), day('b'), day('c'));
    const next = draft(day('a', 90), { ...day('b'), blockId: 'filled-in' }, day('c', 90));
    expect(changedDraftDays(current, next)?.map(item => item.lineId)).toEqual(['a', 'c']);
  });

  it('returns nothing to send when the edit changed no exercise', () => {
    expect(changedDraftDays(draft(day('a')), draft(day('a')))).toEqual([]);
  });

  it('falls back to a whole-draft save when the draft itself was reshaped', () => {
    expect(changedDraftDays(draft(day('a'), day('b')), draft(day('b'), day('a')))).toBeNull();
    expect(changedDraftDays(draft(day('a')), draft(day('a'), day('b')))).toBeNull();
    expect(changedDraftDays(draft(day('a')), { ...draft(day('a')), programName: 'Renamed' })).toBeNull();
  });
});
