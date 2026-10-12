import type {
  Account,
  Bootstrap,
  Exercise,
  HistoryPage,
  Preferences,
  ProgramDay,
  ProgramSummary,
  Session,
  SessionExercise,
  SetPrescription,
  Template,
  TemplateExercise
} from '../types';

export function mockPreferences(overrides: Partial<Preferences> = {}): Preferences {
  return {
    unit: 'kg',
    theme: 'dark',
    restAlerts: false,
    ...overrides
  };
}

export function mockAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    displayName: 'Lifter',
    ...overrides
  };
}

export function mockHistory(overrides: Partial<HistoryPage> = {}): HistoryPage {
  return {
    total: 0,
    page: 0,
    size: 20,
    sessions: [],
    ...overrides
  };
}

export function mockExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'bench',
    slug: 'bench-press',
    name: 'Bench Press',
    muscle: 'Chest',
    equipment: 'Barbell',
    aliases: [],
    loadStepKg: 2.5,
    ...overrides
  };
}

export function mockSetPrescription(overrides: Partial<SetPrescription> = {}): SetPrescription {
  return {
    repMin: 8,
    repMax: 10,
    targetRpe: 8,
    restSeconds: 90,
    tempo: null,
    loadText: null,
    notes: null,
    repsText: null,
    restText: null,
    rir: null,
    warmup: false,
    repsSource: 'extracted',
    rpeSource: 'extracted',
    restSource: 'extracted',
    ...overrides
  };
}

export function mockTemplateExercise(overrides: Partial<TemplateExercise> = {}): TemplateExercise {
  return {
    id: 'te-1',
    exerciseId: 'bench',
    sourceName: 'Bench Press',
    name: 'Bench Press',
    note: '',
    position: 0,
    sequenceGroup: '',
    substitutions: [],
    sets: [mockSetPrescription(), mockSetPrescription()],
    ...overrides
  };
}

export function mockTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'day-1',
    programId: 'prog-1',
    name: 'Upper Body Hypertrophy',
    focus: 'Chest & Back',
    note: '',
    week: 3,
    position: 0,
    revision: 1,
    exercises: [mockTemplateExercise()],
    block: '',
    phase: '',
    phaseWeek: 3,
    isRestDay: false,
    ...overrides
  };
}

export function mockProgramDay(overrides: Partial<ProgramDay> = {}): ProgramDay {
  return {
    id: 'pday-1',
    name: 'Upper Body Hypertrophy',
    focus: 'Chest & Back',
    block: '',
    phase: '',
    week: 1,
    phaseWeek: 1,
    position: 0,
    isRestDay: false,
    exerciseCount: 1,
    ...overrides
  };
}

export function mockProgram(overrides: Partial<ProgramSummary> = {}): ProgramSummary {
  return {
    id: 'prog-1',
    name: 'Strength Block',
    weeks: 4,
    active: true,
    revision: 1,
    sourceImportId: null,
    days: [],
    completedTemplateIds: [],
    nextTemplateId: null,
    lifecycleStatus: 'active',
    ...overrides
  };
}

export function mockSessionExercise(overrides: Partial<SessionExercise> = {}): SessionExercise {
  return {
    id: 'se-1',
    exerciseId: 'bench',
    name: 'Bench Press',
    position: 0,
    note: '',
    prescription: [mockSetPrescription()],
    sets: [
      { id: 's-1', position: 0, weightKg: 80, reps: 8, rpe: 8, done: true, warmup: false },
      { id: 's-2', position: 1, weightKg: 80, reps: 8, rpe: 8, done: false, warmup: false }
    ],
    sequenceGroup: '',
    substitutions: [],
    progression: null,
    ...overrides
  };
}

export function mockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    templateId: 'tpl-1',
    programId: 'prog-1',
    name: 'Push Day',
    note: '',
    active: true,
    startedAt: '2026-10-10T10:00:00Z',
    finishedAt: null,
    revision: 1,
    completedSets: 1,
    warmupSets: 0,
    volumeKg: 80,
    exercises: [mockSessionExercise()],
    ...overrides
  };
}

export function mockBootstrap(overrides: Partial<Bootstrap> = {}): Bootstrap {
  return {
    account: mockAccount(),
    preferences: mockPreferences(),
    exercises: [mockExercise()],
    templates: [],
    programs: [],
    activeProgram: null,
    activeWorkout: null,
    imports: [],
    history: mockHistory(),
    ...overrides
  };
}

