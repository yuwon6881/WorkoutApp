import type { DraftExercise, DraftSet, DraftWorkout, ImportDraft, Program, Template } from '../types';

/// A small program for the edit tests: three weeks, each with training days A and B, and a rest
/// day in week one. Day ids read as `w1a`, `w2b`, `w1r`.
export const set = (min = 8, max = 10): DraftSet => ({
  repMin: min, repMax: max, targetRpe: 8, restSeconds: 90, tempo: null, loadText: null, notes: null,
  repsSource: 'userEdited', rpeSource: 'userEdited', restSource: 'userEdited', repsText: null, restText: null, rir: null, warmup: false
});

export const exercise = (id: string, name = 'Bench press'): DraftExercise => ({
  lineId: `ex-${id}`, sourceName: name, exerciseId: 'bench', notes: null, sets: [set()], sequenceGroup: '',
  substitutions: [], slotKey: `slot-${id}`, restSeconds: 90
});

export const day = (id: string, week: number, over: Partial<DraftWorkout> = {}): DraftWorkout => ({
  lineId: id, week, name: id.toUpperCase(), focus: 'Strength', notes: null, exercises: [exercise(id)],
  block: 'Block 1', phase: null, phaseWeek: week, isRestDay: false, blockId: 'block-1', weekId: `week-${week}`, ...over
});

export const rest = (id: string, week: number): DraftWorkout =>
  day(id, week, { name: 'Rest day', exercises: [], isRestDay: true, focus: null });

export const baseDraft = (): ImportDraft => ({
  programName: 'Three weeks',
  workouts: [day('w1a', 1), day('w1b', 1), rest('w1r', 1), day('w2a', 2), day('w2b', 2), day('w3a', 3), day('w3b', 3)]
});

const template = (source: DraftWorkout, position: number): Template => ({
  id: source.lineId, programId: 'p1', name: source.name, focus: source.focus ?? '', note: '', week: source.week, position,
  revision: 1, exercises: [], block: source.block ?? '', phase: '', phaseWeek: source.phaseWeek, isRestDay: source.isRestDay
});

/// The program as the server returns it while a run is in week `currentWeek`.
export function activeProgram(currentWeek: number, passed: Record<string, 'completed' | 'skipped' | 'rest_passed'> = {}): Program {
  const workouts = baseDraft().workouts.map(template);
  const currentDays = workouts.filter(entry => entry.week === currentWeek);
  return {
    id: 'p1', name: 'Three weeks', weeks: 3, active: true, revision: 4, sourceImportId: null,
    days: [], completedTemplateIds: Object.entries(passed).filter(([, status]) => status === 'completed').map(([id]) => id),
    skippedTemplateIds: Object.entries(passed).filter(([, status]) => status === 'skipped').map(([id]) => id),
    nextTemplateId: null, lifecycleStatus: 'active', workouts,
    progress: {
      runId: 'run-1', currentWeek, currentAttempt: 1, passedDays: 0, totalDays: currentDays.length,
      days: currentDays.map((entry, position) => ({
        templateId: entry.id, status: passed[entry.id] ?? 'pending', isRestDay: entry.isRestDay, position
      }))
    }
  };
}
