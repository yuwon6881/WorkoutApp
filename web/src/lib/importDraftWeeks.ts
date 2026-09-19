import type { DraftExercise, DraftSet, DraftWorkout, ImportDraft } from '../types';

export type Week = {
  week: number;
  sourceWeek: number;
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
  const grouped = new Map<number, Week>();
  for (const day of draft.workouts) {
    const current = grouped.get(day.week);
    if (current) {
      current.days.push(day);
      if (day.phase && !current.phases.includes(day.phase)) current.phases.push(day.phase);
      continue;
    }
    grouped.set(day.week, {
      week: day.week,
      sourceWeek: day.week,
      days: [day],
      block: day.block || 'Program',
      phases: day.phase ? [day.phase] : [],
      pages: []
    });
  }
  return [...grouped.values()]
    .sort((left, right) => left.week - right.week)
    .map((week, index) => ({
      ...week,
      sourceWeek: week.week,
      week: index + 1,
      pages: sourcePages(week.days)
    }));
}

export function renumberDraft(draft: ImportDraft, orderedWeeks: Week[]): ImportDraft {
  const phasePositions = new Map<string, { week: number; position: number }>();
  const workouts = orderedWeeks.flatMap((entry, index) => entry.days.map(day => {
    const week = index + 1;
    if (!day.phase) return { ...day, week };
    const key = `${day.block?.trim() ?? ''}\u001f${day.phase.trim()}`;
    const previous = phasePositions.get(key);
    const position = previous?.week === week ? previous.position : (previous?.position ?? 0) + 1;
    phasePositions.set(key, { week, position });
    return { ...day, week, phaseWeek: position };
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

export function cloneWeekDays(days: DraftWorkout[], week: number): DraftWorkout[] {
  return days.map(day => ({
    ...day,
    lineId: crypto.randomUUID(),
    week,
    phaseWeek: day.phaseWeek + 1,
    sourcePage: null,
    exercises: day.exercises.map(cloneExercise)
  }));
}

export function emptyWeekDay(week: number, latest: Week | undefined): DraftWorkout {
  return {
    lineId: crypto.randomUUID(),
    week,
    name: 'New day',
    focus: null,
    notes: null,
    exercises: [blankExercise()],
    block: latest?.block ?? 'Program',
    phase: latest?.phases[0] ?? null,
    phaseWeek: (latest?.days[0]?.phaseWeek ?? 0) + 1,
    isRestDay: false,
    sourcePage: null
  };
}

export function blankExercise(): DraftExercise {
  const set: DraftSet = {
    repMin: 8,
    repMax: 12,
    targetRpe: 8,
    restSeconds: 90,
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
  return { lineId: crypto.randomUUID(), sourceName: 'New exercise', exerciseId: null, notes: null, sets: [set], sequenceGroup: '', substitutions: [] };
}

export function blockIndex(weeks: Week[], index: number): number {
  let result = 0;
  let previous = '';
  for (let current = 0; current <= index; current++) {
    if (weeks[current].block !== previous) {
      result++;
      previous = weeks[current].block;
    }
  }
  return result;
}

export function weekCaption(week: Week, number: number): string {
  const phase = week.phases.join(' / ') || 'General';
  return [`Block ${number}`, phase].filter(Boolean).join(' · ');
}
