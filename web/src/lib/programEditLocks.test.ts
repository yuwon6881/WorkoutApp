import { describe, expect, it } from 'vitest';
import type { DraftWorkout, ImportDraft } from '../types';
import {
  NO_LOCKS, checkProgramEdit, daySignature, draftToProgramEdit, hasLocks, isEdited, programEditLocks, unmappedExerciseIn
} from './programEditLocks';
import { activeProgram, baseDraft, day, exercise, rest, set } from './programEditFixtures';
import { applyExerciseEdit, countOccurrences, findOccurrences } from './exerciseEditScope';

const withDays = (draft: ImportDraft, change: (days: DraftWorkout[]) => DraftWorkout[]): ImportDraft =>
  ({ ...draft, workouts: change(draft.workouts) });
const rename = (draft: ImportDraft, id: string, name: string) =>
  withDays(draft, days => days.map(item => item.lineId === id ? { ...item, name } : item));

describe('programEditLocks', () => {
  it('locks nothing for a program outside the active slot', () => {
    const library = { ...activeProgram(1), active: false, progress: null };
    expect(programEditLocks(library, null)).toBe(NO_LOCKS);
    expect(hasLocks(NO_LOCKS)).toBe(false);
  });

  it('locks nothing for an active program whose run has not started', () => {
    const locks = programEditLocks({ ...activeProgram(1), progress: null }, null);
    expect(hasLocks(locks)).toBe(false);
  });

  it('locks every day of earlier weeks and the passed days of the current one', () => {
    const program = activeProgram(2, { w2a: 'completed' });
    program.completedTemplateIds.push('w1a');
    program.skippedTemplateIds = ['w1b'];
    const locks = programEditLocks(program, null);
    expect([...locks.lockedDayIds].sort()).toEqual(['w1a', 'w1b', 'w1r', 'w2a']);
    expect(locks.labels.get('w1a')).toBe('Done');
    expect(locks.labels.get('w1b')).toBe('Skipped');
    expect(locks.labels.get('w1r')).toBe('Rest done');
    expect(locks.labels.get('w2a')).toBe('Done');
    expect([...locks.historyWeeks].sort()).toEqual([1, 2]);
    expect(locks.currentWeek).toBe(2);
  });

  it('labels a day skipped in the current week and a passed rest day', () => {
    const program = activeProgram(1, { w1a: 'skipped', w1r: 'rest_passed' });
    const locks = programEditLocks(program, null);
    expect(locks.labels.get('w1a')).toBe('Skipped');
    expect(locks.labels.get('w1r')).toBe('Rest done');
    expect(locks.lockedDayIds.has('w1b')).toBe(false);
  });

  it('pins the day with an open workout but never locks it', () => {
    const locks = programEditLocks(activeProgram(1), 'w1b');
    expect(locks.pinnedDayIds.has('w1b')).toBe(true);
    expect(locks.lockedDayIds.has('w1b')).toBe(false);
  });

  it('ignores an open workout from another plan or from a passed day', () => {
    expect(programEditLocks(activeProgram(1), 'elsewhere').pinnedDayIds.size).toBe(0);
    expect(programEditLocks(activeProgram(1, { w1a: 'completed' }), 'w1a').pinnedDayIds.size).toBe(0);
  });

  it('locks the whole program once the run has finished', () => {
    const finished = { ...activeProgram(3), lifecycleStatus: 'completed' as const };
    expect(programEditLocks(finished, null).lockedDayIds.size).toBe(7);
  });
});

describe('checkProgramEdit', () => {
  const locks = programEditLocks(activeProgram(2, { w2a: 'completed' }), null);
  const original = baseDraft();

  it('accepts anything when nothing is locked', () => {
    expect(checkProgramEdit(original, withDays(original, () => []), NO_LOCKS)).toBeNull();
  });

  it('accepts edits to days and weeks the run has not reached', () => {
    expect(checkProgramEdit(original, rename(original, 'w2b', 'Pending'), locks)).toBeNull();
    expect(checkProgramEdit(original, rename(original, 'w3a', 'Future'), locks)).toBeNull();
    expect(checkProgramEdit(original, withDays(original, days => days.filter(item => item.week < 3)), locks)).toBeNull();
    expect(checkProgramEdit(original, withDays(original, days => [...days, day('w4a', 4)]), locks)).toBeNull();
  });

  it('accepts a new day in the current week, even ahead of a passed one', () => {
    const next = withDays(original, days => [...days.slice(0, 3), day('new', 2), ...days.slice(3)]);
    expect(checkProgramEdit(original, next, locks)).toBeNull();
  });

  it('refuses to change a passed day in any field', () => {
    for (const change of [
      (item: DraftWorkout) => ({ ...item, name: 'Tampered' }),
      (item: DraftWorkout) => ({ ...item, focus: 'Other' }),
      (item: DraftWorkout) => ({ ...item, notes: 'Added note' }),
      (item: DraftWorkout) => ({ ...item, exercises: [] }),
      (item: DraftWorkout) => ({ ...item, exercises: [{ ...item.exercises[0], sets: [set(5, 5)] }] }),
      (item: DraftWorkout) => ({ ...item, exercises: [{ ...item.exercises[0], restSeconds: 30 }] }),
      (item: DraftWorkout) => ({ ...item, exercises: [{ ...item.exercises[0], exerciseId: 'squat' }] }),
      (item: DraftWorkout) => ({ ...item, exercises: [{ ...item.exercises[0], notes: 'x' }] }),
      (item: DraftWorkout) => ({ ...item, block: 'Renamed' })
    ]) {
      const next = withDays(original, days => days.map(item => item.lineId === 'w2a' ? change(item) : item));
      expect(checkProgramEdit(original, next, locks)).toContain('Week 2 "W2A" is already past');
    }
  });

  it('treats trivia the editor never shows as unchanged', () => {
    const next = withDays(original, days => days.map(item => item.lineId === 'w1a'
      ? { ...item, phaseWeek: 9, sourcePage: 4, weekId: 'x', blockId: 'y', name: ` ${item.name} ` }
      : item));
    expect(checkProgramEdit(original, next, locks)).toBeNull();
  });

  it('reads a blank block and the default Program label as the same block', () => {
    const unnamed = withDays(original, days => days.map(item => ({ ...item, block: '' })));
    const labelled = withDays(unnamed, days => days.map(item => ({ ...item, block: 'Program' })));
    expect(checkProgramEdit(unnamed, labelled, locks)).toBeNull();
  });

  it('refuses to delete a passed day or a day of an earlier week', () => {
    expect(checkProgramEdit(original, withDays(original, days => days.filter(item => item.lineId !== 'w2a')), locks)).toContain("can't be removed");
    expect(checkProgramEdit(original, withDays(original, days => days.filter(item => item.lineId !== 'w1b')), locks)).toContain("can't be removed");
  });

  it('refuses to add or move a day into an earlier week', () => {
    const added = withDays(original, days => [...days, day('sneak', 1)]);
    expect(checkProgramEdit(original, added, locks)).toContain('Weeks before Week 2');
    const moved = withDays(original, days => days.map(item => item.lineId === 'w2b' ? { ...item, week: 1 } : item));
    expect(checkProgramEdit(original, moved, locks)).toContain('Weeks before Week 2');
  });

  it('refuses to move a passed day to another week', () => {
    const moved = withDays(original, days => days.map(item => item.lineId === 'w2a' ? { ...item, week: 3 } : item));
    expect(checkProgramEdit(original, moved, locks)).toContain('already past');
  });

  it('refuses to reorder passed days', () => {
    const swapped = withDays(original, days => {
      const copy = [...days];
      [copy[0], copy[1]] = [copy[1], copy[0]];
      return copy;
    });
    expect(checkProgramEdit(original, swapped, locks)).toContain("can't be reordered");
  });

  it('allows a pending day to move around the passed ones', () => {
    const draft = withDays(original, days => [...days.filter(item => item.week !== 2), day('w2b', 2), day('w2a', 2)]);
    const reordered = withDays(draft, days => days);
    expect(checkProgramEdit(draft, reordered, locks)).toBeNull();
  });

  it('keeps the week in progress from losing every day', () => {
    const next = withDays(original, days => days.filter(item => item.week !== 2 || item.lineId === 'w2a').filter(item => item.lineId !== 'w2a'));
    const noCurrent = checkProgramEdit(original, next, locks);
    expect(noCurrent).not.toBeNull();
    const pendingOnly = programEditLocks(activeProgram(3), null);
    expect(checkProgramEdit(original, withDays(original, days => days.filter(item => item.week !== 3)), pendingOnly))
      .toContain('Week 3 is in progress');
  });

  it('keeps the day with an open workout in its week', () => {
    const pinned = programEditLocks(activeProgram(1), 'w1b');
    expect(checkProgramEdit(original, rename(original, 'w1b', 'Adjusted'), pinned)).toBeNull();
    expect(checkProgramEdit(original, withDays(original, days => days.filter(item => item.lineId !== 'w1b')), pinned)).toContain('workout in progress');
    expect(checkProgramEdit(original, withDays(original, days => days.map(item => item.lineId === 'w1b' ? { ...item, week: 2 } : item)), pinned))
      .toContain("can't move to another week");
  });
});

describe('draftToProgramEdit', () => {
  it('keeps the ids of known days and sends new days without one', () => {
    const draft = withDays(baseDraft(), days => [...days, day('brand-new', 3)]);
    const input = draftToProgramEdit(draft, 7, new Set(baseDraft().workouts.map(item => item.lineId)), 'request-1');
    expect(input.revision).toBe(7);
    expect(input.idempotencyId).toBe('request-1');
    expect(input.days.filter(item => item.id === null).map(item => item.name)).toEqual(['BRAND-NEW']);
    expect(input.days.find(item => item.name === 'W1A')?.id).toBe('w1a');
  });

  it('orders days by week and keeps their order within a week', () => {
    const draft = withDays(baseDraft(), days => [days[3], days[0], days[2], days[1]]);
    const input = draftToProgramEdit(draft, 1, new Set(), 'r');
    expect(input.days.map(item => item.name)).toEqual(['W1A', 'Rest day', 'W1B', 'W2A']);
  });

  it('sends the same exercise fields a single-day save sends, resistance mode included', () => {
    const assisted = { ...set(), resistanceMode: 'assistance' as const };
    const draft = { programName: ' Plan ', workouts: [day('a', 1, { exercises: [{ ...exercise('a'), sets: [assisted], notes: 'Pause' }] })] };
    const input = draftToProgramEdit(draft, 1, new Set(['a']), 'r');
    expect(input.name).toBe('Plan');
    expect(input.days[0].exercises[0]).toMatchObject({
      exerciseId: 'bench', note: 'Pause', slotKey: 'slot-a', restSeconds: 90, sets: [assisted]
    });
  });
});

describe('edit helpers', () => {
  it('reports whether the document differs from what was loaded', () => {
    expect(isEdited(baseDraft(), baseDraft())).toBe(false);
    expect(isEdited(baseDraft(), rename(baseDraft(), 'w3a', 'Different'))).toBe(true);
  });

  it('asks for a library exercise only on days that changed or are new', () => {
    const legacy = withDays(baseDraft(), days => days.map(item => item.lineId === 'w3b' ? { ...item, exercises: [{ ...item.exercises[0], exerciseId: null }] } : item));
    expect(unmappedExerciseIn(legacy, legacy)).toBeNull();
    const touched = rename(legacy, 'w3b', 'Touched');
    expect(unmappedExerciseIn(legacy, touched)).toContain('Select a library exercise');
    const added = withDays(baseDraft(), days => [...days, day('n', 3, { exercises: [{ ...exercise('n'), exerciseId: null }] })]);
    expect(unmappedExerciseIn(baseDraft(), added)).toContain('Select a library exercise');
    const addedRest = withDays(baseDraft(), days => [...days, rest('r2', 3)]);
    expect(unmappedExerciseIn(baseDraft(), addedRest)).toBeNull();
  });

  it('compares days by what a lifter sees', () => {
    const a = day('x', 1);
    expect(daySignature(a)).toBe(daySignature({ ...a, phaseWeek: 5, sourcePage: 3, weekId: 'other' }));
    expect(daySignature(a)).not.toBe(daySignature({ ...a, name: 'Other' }));
  });
});

describe('scoped exercise edits skip frozen days', () => {
  const draft = baseDraft();
  const frozen = new Set(['w1a', 'w1b']);
  const base = draft.workouts[3].exercises[0];

  it('counts only the days an edit can still reach', () => {
    // Six training days carry the movement; the edited one is not counted against itself.
    expect(countOccurrences(draft, base).program).toBe(5);
    expect(countOccurrences(draft, base, frozen).program).toBe(3);
    expect(findOccurrences(draft, base, 'program', frozen).map(item => item.workoutLineId)).not.toContain('w1a');
  });

  it('leaves frozen days exactly as they were', () => {
    const edited = { ...base, notes: 'Pause reps' };
    const next = applyExerciseEdit(draft, base, edited, 'program', [], frozen);
    expect(next.workouts.find(item => item.lineId === 'w1a')).toEqual(draft.workouts[0]);
    expect(next.workouts.find(item => item.lineId === 'w3a')?.exercises[0].notes).toBe('Pause reps');
    const everywhere = applyExerciseEdit(draft, base, edited, 'program', []);
    expect(everywhere.workouts.find(item => item.lineId === 'w1a')?.exercises[0].notes).toBe('Pause reps');
  });
});
