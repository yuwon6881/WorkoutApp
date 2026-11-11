import { describe, expect, it } from 'vitest';
import type { DraftWorkout, ImportDraft } from '../types';
import { changedDraftDays, shareUnchangedDays } from './importDraftDiff';

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

describe('sharing unchanged days with a saved draft', () => {
  const copy = (value: ImportDraft): ImportDraft => JSON.parse(JSON.stringify(value));

  it('hands back the same object for every day the server returned unchanged', () => {
    const current = draft(day('a'), day('b'), day('c'));
    const saved = copy(current);
    saved.workouts[1] = day('b', 90);
    const shared = shareUnchangedDays(current, saved);
    expect(shared.workouts[0]).toBe(current.workouts[0]);
    expect(shared.workouts[2]).toBe(current.workouts[2]);
    expect(shared.workouts[1]).toEqual(saved.workouts[1]);
    expect(shared.workouts[1]).not.toBe(current.workouts[1]);
  });

  it('returns the previous draft itself when nothing differs', () => {
    const current = draft(day('a'), day('b'));
    expect(shareUnchangedDays(current, copy(current))).toBe(current);
  });

  it('never keeps content the server changed, even for a day it did not edit', () => {
    const current = draft(day('a'), day('b'));
    const saved = copy(current);
    saved.workouts[0].weekId = 'unified';
    const shared = shareUnchangedDays(current, saved);
    expect(shared.workouts[0].weekId).toBe('unified');
    expect(shared.workouts[1]).toBe(current.workouts[1]);
  });

  it('takes the saved draft as is when the days were added, removed or renamed', () => {
    const current = draft(day('a'));
    const saved = { ...copy(draft(day('a'), day('b'))), programName: 'Renamed' };
    expect(shareUnchangedDays(current, saved)).toEqual(saved);
    expect(shareUnchangedDays(null, saved)).toBe(saved);
  });
});
