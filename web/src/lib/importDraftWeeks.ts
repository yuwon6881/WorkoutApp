import type { DraftExercise, DraftSet, DraftWorkout, ImportDraft } from '../types';

export type Week = {
  week: number;
  sourceWeek: number;
  weekId: string;
  blockId: string;
  days: DraftWorkout[];
  block: string;
  phases: string[];
  pages: number[];
};

export function sourcePages(days: DraftWorkout[]): number[] {
  const pages = days.flatMap(day => [
    day.sourcePage,
    ...day.exercises.flatMap(exercise => [exercise.sourcePage, ...exercise.sets.map(set => set.sourcePage)])
  ]);
  return [...new Set(pages.filter((page): page is number => page != null))].sort((left, right) => left - right);
}

export function groupWeeks(draft: ImportDraft): Week[] {
  const grouped = new Map<string, Week>();
  for (const day of draft.workouts) {
    const key = day.weekId || `legacy-week-${day.week}`;
    const current = grouped.get(key);
    if (current) {
      current.days.push(day);
      if (day.phase && !current.phases.includes(day.phase)) current.phases.push(day.phase);
      continue;
    }
    grouped.set(key, {
      week: day.week,
      sourceWeek: day.week,
      weekId: day.weekId || key,
      blockId: day.blockId || '',
      days: [day],
      block: day.block || 'Program',
      phases: day.phase ? [day.phase] : [],
      pages: []
    });
  }
  const ordered = [...grouped.values()].sort((left, right) => left.week - right.week);
  let previousBlockLabel = '';
  let previousBlockId = '';
  return ordered.map((week, index) => {
    const explicitBlockId = week.blockId || week.days.find(day => day.blockId)?.blockId || '';
    const blockLabel = (week.block || 'Program').trim().toLocaleLowerCase();
    const blockId = explicitBlockId || (previousBlockLabel === blockLabel
      ? previousBlockId
      : `legacy-block-${week.weekId}`);
    previousBlockLabel = blockLabel;
    previousBlockId = blockId;
    return {
      ...week,
      blockId,
      sourceWeek: week.week,
      week: index + 1,
      pages: sourcePages(week.days)
    };
  });
}

export function ensureStructureIds(draft: ImportDraft): ImportDraft {
  const weeks = groupWeeks(draft);
  const blockIds = new Map(weeks.map(week => [week.blockId,
    week.blockId.startsWith('legacy-block-') ? crypto.randomUUID() : week.blockId]));
  const weekIds = new Map(weeks.map(week => [week.weekId,
    week.weekId.startsWith('legacy-week-') ? crypto.randomUUID() : week.weekId]));
  return {
    ...draft,
    workouts: weeks.flatMap(week => week.days.map(day => ({
      ...day,
      blockId: blockIds.get(day.blockId || week.blockId)!,
      weekId: weekIds.get(day.weekId || week.weekId)!
    })))
  };
}

export function renumberDraft(draft: ImportDraft, orderedWeeks: Week[]): ImportDraft {
  const phasePositions = new Map<string, { week: number; position: number }>();
  const workouts = orderedWeeks.flatMap((entry, index) => entry.days.map(day => {
    const week = index + 1;
    const key = `${entry.blockId}\u001f${day.phase?.trim() ?? ''}`;
    const previous = phasePositions.get(key);
    const position = previous?.week === week ? previous.position : (previous?.position ?? 0) + 1;
    phasePositions.set(key, { week, position });
    return { ...day, week, blockId: entry.blockId, weekId: entry.weekId, block: entry.block, phaseWeek: position };
  }));
  return { ...draft, workouts };
}

export function cloneSet(set: DraftSet): DraftSet {
  return {
    ...set,
    sourcePage: null,
    repsSource: 'userEdited',
    rpeSource: 'userEdited',
    restSource: 'userEdited'
  };
}

export function cloneExercise(exercise: DraftExercise): DraftExercise {
  return { ...exercise, lineId: crypto.randomUUID(), sourcePage: null, sets: exercise.sets.map(cloneSet) };
}

export function cloneWeekDays(days: DraftWorkout[], week: number, weekId = crypto.randomUUID()): DraftWorkout[] {
  return days.map(day => ({
    ...day,
    lineId: crypto.randomUUID(),
    week,
    weekId,
    phaseWeek: day.phaseWeek + 1,
    sourcePage: null,
    exercises: day.exercises.map(cloneExercise)
  }));
}

export function emptyWeekDay(
  week: number,
  latest: Week | undefined,
  weekId = crypto.randomUUID(),
  phaseWeek = latest?.days[0]?.phaseWeek ?? 1
): DraftWorkout {
  return {
    lineId: crypto.randomUUID(),
    week,
    weekId,
    blockId: latest?.blockId ?? crypto.randomUUID(),
    name: 'New day',
    focus: null,
    notes: null,
    exercises: [blankExercise()],
    block: latest?.block ?? 'Program',
    phase: latest?.phases[0] ?? null,
    phaseWeek,
    isRestDay: false,
    sourcePage: null
  };
}

export function emptyRestDay(week: number, source: Week, weekId = source.weekId): DraftWorkout {
  return {
    lineId: crypto.randomUUID(),
    week,
    weekId,
    blockId: source.blockId,
    name: 'Rest day',
    focus: null,
    notes: null,
    exercises: [],
    block: source.block,
    phase: source.phases[0] ?? null,
    phaseWeek: source.days[0]?.phaseWeek ?? 1,
    isRestDay: true,
    sourcePage: null
  };
}

export function createEmptyProgramDraft(): ImportDraft {
  const blockId = crypto.randomUUID();
  const weekId = crypto.randomUUID();
  const blockName = 'Block 1';
  const firstWeek: Week = {
    week: 1, sourceWeek: 1, weekId, blockId, days: [], block: blockName, phases: [], pages: []
  };
  const day = {
    ...emptyWeekDay(1, firstWeek, weekId),
    name: 'Day 1',
    blockId,
    weekId,
    block: blockName
  };
  return { programName: '', workouts: [day] };
}

export function cloneWeek(workouts: DraftWorkout[], week: Week, nextWeek: number, weekId = crypto.randomUUID()): Week {
  return {
    ...week,
    week: nextWeek,
    sourceWeek: nextWeek,
    weekId,
    days: cloneWeekDays(workouts, nextWeek, weekId),
    pages: []
  };
}

export function blankExercise(): DraftExercise {
  const set: DraftSet = {
    repMin: 8,
    repMax: 12,
    targetRpe: 8,
    restSeconds: null,
    tempo: null,
    loadText: null,
    notes: null,
    repsSource: 'userEdited',
    rpeSource: 'userEdited',
    restSource: 'userEdited',
    repsText: null,
    restText: null,
    rir: null,
    warmup: false
  };
  return { lineId: crypto.randomUUID(), sourceName: 'New exercise', exerciseId: null, notes: null, sets: [set], sequenceGroup: '', substitutions: [], restSeconds: 90 };
}

export function blockIndex(weeks: Week[], index: number): number {
  let result = 0;
  let previous = '';
  for (let current = 0; current <= index; current++) {
    const block = weeks[current].blockId;
    if (block !== previous) {
      result++;
      previous = block;
    }
  }
  return result;
}

export function weekCaption(week: Week, number: number): string {
  const phase = week.phases.join(' / ') || 'General';
  return [`Block ${number}`, phase].filter(Boolean).join(' · ');
}

export function orderedBlocks(weeks: Week[]): { id: string; name: string; weeks: Week[] }[] {
  const blocks: { id: string; name: string; weeks: Week[] }[] = [];
  for (const week of weeks) {
    let block = blocks.find(candidate => candidate.id === week.blockId);
    if (!block) {
      block = { id: week.blockId, name: week.block || 'Program', weeks: [] };
      blocks.push(block);
    }
    block.weeks.push(week);
  }
  return blocks;
}

export function isExerciseEmpty(exercise: DraftExercise): boolean {
  if (exercise.exerciseId != null) return false;
  if (exercise.notes && exercise.notes.trim().length > 0) return false;
  if (exercise.sourcePage != null) return false;
  if (exercise.sequenceGroup && exercise.sequenceGroup.trim().length > 0) return false;
  if (exercise.substitutions && exercise.substitutions.length > 0) return false;
  const name = exercise.sourceName?.trim().toLowerCase();
  if (name && name !== 'new exercise' && name !== 'exercise') return false;
  if (exercise.sets.length > 1) return false;
  if (exercise.sets.some(s => s.loadText || s.notes || s.warmup || s.repsText || s.restText)) return false;
  return true;
}

export function isDayEmpty(day: DraftWorkout): boolean {
  if (day.sourcePage != null) return false;
  if (day.focus && day.focus.trim().length > 0) return false;
  if (day.notes && day.notes.trim().length > 0) return false;
  const name = day.name?.trim().toLowerCase();
  const isDefaultName = !name || name === 'new day' || name === 'rest day' || /^day\s*\d*$/i.test(name);
  if (!isDefaultName) return false;
  if (day.isRestDay) return true;
  return day.exercises.length === 0 || day.exercises.every(isExerciseEmpty);
}

export function isWeekEmpty(week: Week): boolean {
  return week.days.length === 0 || week.days.every(isDayEmpty);
}

export function isBlockEmpty(block: { weeks: Week[] }): boolean {
  return block.weeks.length === 0 || block.weeks.every(isWeekEmpty);
}
