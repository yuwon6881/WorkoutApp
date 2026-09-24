// Mirrors the API contract. Loads are always kilograms on the wire; only display converts.
export type Unit = 'kg' | 'lb';
export type Theme = 'dark' | 'light';
export type Provenance = 'extracted' | 'inferred' | 'userEdited';

export type LoadModel = 'external' | 'full_bodyweight' | 'bodyweight_context_only' | 'reps_only';
export type ResistanceMode = 'external' | 'bodyweight' | 'added' | 'assistance' | 'reps_only';
export type ExerciseCategory = 'Free Weights' | 'Machine' | 'Body Weight';
export type Exercise = { id: string; slug: string; name: string; muscle: string; secondaryMuscles?: string[]; equipment: string; category?: ExerciseCategory; cue: string; aliases: string[]; loadStepKg: number; loadModel?: LoadModel; movementPattern?: string; source?: 'catalog' | 'custom'; isCustom?: boolean; archived?: boolean };
export type Preferences = { unit: Unit; theme: Theme; restSeconds?: number; restAlerts: boolean };
export type Account = { id: string; displayName: string };

export type SetPrescription = {
  repMin: number; repMax: number; targetRpe: number | null; restSeconds: number | null; tempo: string | null;
  loadText: string | null; notes: string | null; repsText: string | null; restText: string | null;
  rir: string | null; warmup: boolean; repsSource: Provenance; rpeSource: Provenance; restSource: Provenance; resistanceMode?: ResistanceMode; sourcePage?: number | null;
};
export type TemplateExercise = { id: string; exerciseId: string | null; sourceName: string; name: string; note: string; position: number; sets: SetPrescription[]; sequenceGroup: string; substitutions: string[]; loadModel?: LoadModel; sourcePage?: number | null; slotKey?: string | null; canRestore?: boolean; isModified?: boolean; restSeconds?: number | null; demoUrl?: string | null; demoLinks?: Record<string, string> | null };
export type Template = { id: string; programId: string | null; name: string; focus: string; note: string; week: number; position: number; revision: number; exercises: TemplateExercise[]; block: string; phase: string; phaseWeek: number; isRestDay: boolean; sourcePage?: number | null; phaseId?: string | null; canRestore?: boolean; isLegacyBaseline?: boolean };
export type ProgramDayStatus = 'pending' | 'completed' | 'skipped' | 'rest_passed';
export type ProgramProgressDay = { templateId: string; status: ProgramDayStatus; isRestDay: boolean; position: number };
export type ProgramProgress = { runId: string; currentWeek: number; currentAttempt: number; passedDays: number; totalDays: number; days: ProgramProgressDay[] };
export type ProgramDayActionInput = { revision: number; runId: string; week: number; attempt: number; idempotencyId: string };
export type ProgramWeekResetInput = ProgramDayActionInput & { confirmation: string };
export type ProgramDay = { id: string; name: string; focus: string; block: string; phase: string; week: number; phaseWeek: number; position: number; isRestDay: boolean; exerciseCount: number; sourcePage?: number | null; progressStatus?: ProgramDayStatus | null };
export type ProgramPhase = { id: string; name: string; block: string; weekFrom: number; weekTo: number; durationWeeks: number; completedWorkouts: number; totalWorkouts: number; complete: boolean; currentWeek?: number; skippedWorkouts?: number; sourcePageFrom?: number | null; sourcePageTo?: number | null };
export type ProgramSummary = { id: string; name: string; weeks: number; active: boolean; revision: number; sourceImportId: string | null; days: ProgramDay[]; completedTemplateIds: string[]; nextTemplateId: string | null; lifecycleStatus?: 'standby' | 'active' | 'completed'; completedAt?: string | null; skippedTemplateIds?: string[]; phases?: ProgramPhase[]; progress?: ProgramProgress | null };
export type Program = ProgramSummary & { workouts: Template[] };

export type SetProgressionSuggestion = { suggestedLoadKg: number | null; suggestedReps: number; reason: string; sourceSessionId: string | null; sourceDate: string | null; progressionMode: string; nutritionContextRevision: number | null; isBodyweightAdjustment: boolean; suggestedSystemLoadKg: number | null; resistanceMode: ResistanceMode };
export type LoggedSet = { id: string; position: number; weightKg: number | null; reps: number | null; rpe: number | null; done: boolean; warmup: boolean; workingSetOrdinal?: number | null; resistanceMode?: ResistanceMode; systemLoadKg?: number | null; suggestion?: SetProgressionSuggestion | null; isPr?: boolean; estimated1RmKg?: number | null; rir?: string | null };
/// What the server suggested for this exercise when the workout started, and why. Every figure
/// is optional: a first session has nothing to go on, and that is shown rather than filled in.
export type Progression = { suggestedKg: number | null; targetReps: number; reason: string; lastE1rmKg: number | null; trendE1rmKg: number | null; stepKg: number; progressionMode?: string; nutritionContextRevision?: number | null };
export type BodyWeightSnapshot = { scaleWeightKg: number | null; scaleDate: string | null; trendWeightKg: number | null; trendDate: string | null; referenceKg: number; referenceSource: string; referenceDate: string | null; calculationVersion: string; nutritionRevision: number | null; capturedAt: string };
export type NutritionTrainingContext = { subject: string; revision: number; timeZone: string; effectiveGoal: string; phaseComplete: boolean; targetRatePercent: number | null; observedLossRatePercent: number | null; observedWindowDays: number | null; scaleWeightKg: number | null; scaleWeightDate: string | null; trendWeightKg: number | null; trendWeightDate: string | null; retrievedAt?: string; confirmed: boolean; cached?: boolean; error?: string | null };
export type SessionExercise = { id: string; exerciseId: string | null; name: string; position: number; note: string; prescription: SetPrescription[]; sets: LoggedSet[]; sequenceGroup: string; substitutions: string[]; progression: Progression | null; loadModel?: LoadModel; sourceTemplateExerciseId?: string | null; sourceSlotKey?: string | null; sourcePhaseId?: string | null; swapGroupKey?: string | null; isReplacement?: boolean; originalExerciseId?: string | null; originalName?: string; sourcePage?: number | null; canRestore?: boolean; restSeconds?: number | null; isPr?: boolean; prE1rmKg?: number | null; demoUrl?: string | null };
export type Session = { id: string; templateId: string | null; programId: string | null; name: string; note: string; active: boolean; startedAt: string; finishedAt: string | null; pausedAt?: string | null; pausedSeconds?: number; revision: number; exercises: SessionExercise[]; volumeKg: number | null; completedSets: number; warmupSets: number; bodyWeight?: BodyWeightSnapshot | null; nutritionContext?: NutritionTrainingContext | null; systemVolumeKg?: number | null; prCount?: number };
export type HistoryPage = { total: number; page: number; size: number; sessions: Session[] };
export type ProgressExercise = {
  exerciseId: string | null; exercise: string; sessions: number; heaviestKg: number | null; heaviestReps: number | null; volumeKg: number | null;
  estimatedMaxKg: number | null; lastEstimatedMaxKg: number | null; externalLoadPrKg: number | null; addedLoadPrKg: number | null;
  assistanceReductionPrKg: number | null; systemLoadPrKg: number | null; repPr: number | null; estimatedSystemLoadMaxKg: number | null;
  relativeStrength: number | null; bodyweightRepRecord: { reps: number; bodyweightKg: number } | null;
};
export type ProgressSummary = { sessions: number; exercises: ProgressExercise[]; totalVolumeKg?: number | null; workingSets?: number; trainingMinutes?: number; weekSessions?: number; weekVolumeKg?: number | null; weekWorkingSets?: number };
export type MuscleBalanceRange = '1w' | '1m' | '3m';
export type MuscleBalanceRow = {
  muscle: string;
  sets: number;
  primarySets: number;
  secondarySets: number;
  sessions: number;
  lastTrainedDate: string | null;
};
export type MuscleBalanceView = {
  range: MuscleBalanceRange;
  from: string;
  to: string;
  weeks: number;
  sessions: number;
  totalSets: number;
  muscles: MuscleBalanceRow[];
  unattributedSets: number;
  unattributedExamples: string[];
};
export type WorkoutActivityItem = { id: string; name: string; status: 'completed' | 'in_progress'; date: string };
export type ExerciseMetricPoint = { date: string; sessionId: string; sessionName: string; estimated1RmKg: number | null; loadKg: number | null; volumeKg: number | null; reps: number | null; partial: boolean };
export type ExerciseHistoryRow = { sessionId: string; sessionName: string; date: string; setCount: number; volumeKg: number | null; partial: boolean; finishedAt: string | null };
export type ExerciseHistoryClear = { clearedAt: string; removedSets: number; affectedWorkouts: number };
export type ExerciseInsight = { id: string; name: string; muscle: string; equipment: string; cue: string; loadModel: LoadModel; loadStepKg: number; isCustom: boolean; archived: boolean; sessions: number; setCount: number; clearableSetCount: number; estimated1RmKg: number | null; estimated1RmDate: string | null; heaviestKg: number | null; heaviestReps: number | null; heaviestDate: string | null; largestSetVolumeKg: number | null; largestSetVolumeDate: string | null; largestSessionVolumeKg: number | null; largestSessionVolumeDate: string | null; repPr: number | null; repPrDate: string | null; lastPerformedDate: string | null; partialVolume: boolean; points: ExerciseMetricPoint[]; history: ExerciseHistoryRow[]; page: number; size: number; totalHistoryRows: number; externalLoadPrKg?: number | null; addedLoadPrKg?: number | null; assistanceReductionPrKg?: number | null; systemLoadPrKg?: number | null; historyClears?: ExerciseHistoryClear[] };
export type ExerciseClearPreview = { exerciseId: string; name: string; affectedWorkouts: number; affectedSets: number; hasActiveWorkout: boolean; canClear: boolean };

export type DraftSet = {
  repMin: number; repMax: number; targetRpe: number | null; restSeconds: number | null; tempo: string | null; loadText: string | null; notes: string | null;
  repsSource: Provenance; rpeSource: Provenance; restSource: Provenance; repsText: string | null; restText: string | null;
  rir: string | null; warmup: boolean; sourcePage?: number | null;
};
export type DraftExercise = { lineId: string; sourceName: string; exerciseId: string | null; notes: string | null; sets: DraftSet[]; sequenceGroup: string; substitutions: string[]; sourcePage?: number | null; slotKey?: string | null; restSeconds?: number | null; demoUrl?: string | null; demoLinks?: Record<string, string> | null };
export type DraftWorkout = { lineId: string; week: number; name: string; focus: string | null; notes: string | null; exercises: DraftExercise[]; block: string | null; phase: string | null; phaseWeek: number; isRestDay: boolean; sourcePage?: number | null; blockId?: string | null; weekId?: string | null };
/// sourceWeekDays is the longest week the PDF confirms (10 for a ten-day cycle); set by the server.
export type ImportDraft = { programName: string; workouts: DraftWorkout[]; sourceWeekDays?: number | null };
/// Custom program drafts use the same editable workout document as PDF review, with stable
/// structural IDs where the editor has assigned them.
export type ProgramEditorDocument = ImportDraft;
export type ImportView = {
  id: string; status: 'pending' | 'ready' | 'failed' | 'accepted' | 'discarded';
  fileName: string; pages: number; error: string; created: string; model: string; stage: 'outline' | 'select' | 'extract' | 'done'; chunksDone: number; chunksTotal: number; currentChunkLabel: string | null; unresolvedCount: number;
  draft: ImportDraft | null; unresolved: { lineId: string; sourceName: string; slotKey?: string | null; block?: string | null; occurrences?: number }[]; acceptable: boolean; programId: string | null;
  reviewIssues?: { code: string; message: string; severity: string; sourcePage?: number | null; workoutLineId?: string | null; exerciseLineId?: string | null; setIndex?: number | null; targetField?: string | null }[]; inputTokens?: number; outputTokens?: number; retries?: number; pageCoverage?: { page: number; hasText: boolean; characterCount: number }[]; alternatives?: { id: string; name: string; chunkCount: number; dayCount: number }[]; selectedAlternativeId?: string | null;
  revision: number; canRestoreDraft?: boolean; restorableExerciseLineIds?: string[];
};
export type ImportStatusView = {
  id: string; status: ImportView['status']; stage: ImportView['stage']; chunksDone: number; chunksTotal: number;
  currentChunkLabel: string | null; error: string; revision: number; retries: number; unresolvedCount: number;
};

export type Bootstrap = {
  account: Account; preferences: Preferences; exercises: Exercise[]; templates: Template[];
  programs: ProgramSummary[]; activeProgram: ProgramSummary | null; activeWorkout: Session | null;
  imports: ImportView[]; history: HistoryPage; progress?: ProgressSummary; aiImportsRemaining: number;
};

/// What the shell reports about the connection to the server. Nothing about workout data is
/// stored on the device, so these states are the whole truth about whether work is safe.
export type SaveState = 'connecting' | 'idle' | 'saving' | 'saved' | 'failed' | 'signed-out' | 'offline';

export type SubstitutionScope = 'slot' | 'phase';
export type SubstitutionCandidate = { exerciseId: string; name: string; muscle: string; secondaryMuscles?: string[]; equipment: string; cue: string; source: 'imported' | 'similar' | 'library'; rank: number; isCatalog: boolean; movementPattern?: string };
export type SubstitutionAffectedSlot = { templateId: string; templateExerciseId: string; slotKey: string; week: number; workoutName: string };
export type TemplateSubstitutionResult = { template: Template; scope: SubstitutionScope; affectedSlots: SubstitutionAffectedSlot[] };
