import { describe, expect, it } from 'vitest';
import { createEmptyProgramDraft, emptyWeekDay, groupWeeks, isBlockEmpty, renumberDraft } from './importDraftWeeks';

describe('emptyWeekDay progression index', () => {
  it('inherits the selected week index when adding another day', () => {
    const week = groupWeeks(createEmptyProgramDraft())[0];
    week.days[0].phaseWeek = 3;

    expect(emptyWeekDay(week.week, week).phaseWeek).toBe(3);
  });

  it('accepts the next progression index when adding an empty week', () => {
    const week = groupWeeks(createEmptyProgramDraft())[0];
    week.days[0].phaseWeek = 3;

    expect(emptyWeekDay(week.week + 1, week, crypto.randomUUID(), week.days[0].phaseWeek + 1).phaseWeek).toBe(4);
  });

  it('renumbers phase-less custom weeks after an earlier week is removed', () => {
    const draft = createEmptyProgramDraft();
    const first = draft.workouts[0];
    const second = { ...first, lineId: crypto.randomUUID(), week: 2, weekId: crypto.randomUUID(), phaseWeek: 2 };
    const third = { ...first, lineId: crypto.randomUUID(), week: 3, weekId: crypto.randomUUID(), phaseWeek: 3 };
    const multiWeekDraft = { ...draft, workouts: [first, second, third] };
    const reordered = renumberDraft(multiWeekDraft, groupWeeks(multiWeekDraft).slice(1));

    expect(reordered.workouts.map(day => [day.week, day.phaseWeek])).toEqual([[1, 1], [2, 2]]);
  });

  it('correctly identifies empty blocks versus customized blocks', () => {
    const draft = createEmptyProgramDraft();
    const weeks = groupWeeks(draft);
    expect(isBlockEmpty({ weeks })).toBe(true);

    // If an exercise is renamed to a real name, it is not empty
    const customizedDraft = createEmptyProgramDraft();
    customizedDraft.workouts[0].exercises[0].sourceName = 'Bench Press';
    expect(isBlockEmpty({ weeks: groupWeeks(customizedDraft) })).toBe(false);

    // If an exercise has an exerciseId, it is not empty
    const mappedDraft = createEmptyProgramDraft();
    mappedDraft.workouts[0].exercises[0].exerciseId = 'catalog-bench';
    expect(isBlockEmpty({ weeks: groupWeeks(mappedDraft) })).toBe(false);

    // If a day has a custom name, it is not empty
    const renamedDayDraft = createEmptyProgramDraft();
    renamedDayDraft.workouts[0].name = 'Upper Body';
    expect(isBlockEmpty({ weeks: groupWeeks(renamedDayDraft) })).toBe(false);
  });
});
