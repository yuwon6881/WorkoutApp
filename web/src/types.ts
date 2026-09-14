// Mirrors the API contract. Loads are always kilograms on the wire; only display converts.
export type Unit = 'kg' | 'lb';
export type Theme = 'dark' | 'light';
export type Provenance = 'extracted' | 'inferred' | 'userEdited';

export type Exercise = { id: string; slug: string; name: string; muscle: string; equipment: string; cue: string; aliases: string[] };
export type Preferences = { unit: Unit; theme: Theme; restSeconds: number };
export type Account = { id: string; username: string };

export type SetPrescription = {
  repMin: number; repMax: number; targetRpe: number | null; restSeconds: number | null; tempo: string | null;
  loadText: string | null; notes: string | null; repsText: string | null; restText: string | null;
  percent1Rm: string | null; rir: string | null; warmup: boolean; repsSource: Provenance; rpeSource: Provenance; restSource: Provenance;
};
export type TemplateExercise = { id: string; exerciseId: string | null; sourceName: string; name: string; note: string; position: number; sets: SetPrescription[]; sequenceGroup: string; substitutions: string[] };
export type Template = { id: string; programId: string | null; name: string; focus: string; note: string; week: number; position: number; revision: number; exercises: TemplateExercise[]; block: string; phase: string; phaseWeek: number; isRestDay: boolean };
export type ProgramDay = { id: string; name: string; focus: string; block: string; phase: string; week: number; phaseWeek: number; position: number; isRestDay: boolean; exerciseCount: number };
export type ProgramSummary = { id: string; name: string; description: string; weeks: number; active: boolean; revision: number; sourceImportId: string | null; days: ProgramDay[]; completedTemplateIds: string[]; nextTemplateId: string | null };
export type Program = ProgramSummary & { workouts: Template[] };

export type LoggedSet = { id: string; position: number; weightKg: number | null; reps: number | null; rpe: number | null; done: boolean; warmup: boolean };
export type SessionExercise = { id: string; exerciseId: string | null; name: string; position: number; note: string; prescription: SetPrescription[]; sets: LoggedSet[]; sequenceGroup: string; substitutions: string[] };
export type Session = { id: string; templateId: string | null; programId: string | null; name: string; note: string; active: boolean; startedAt: string; finishedAt: string | null; revision: number; exercises: SessionExercise[]; volumeKg: number | null; completedSets: number; warmupSets: number };
export type HistoryPage = { total: number; page: number; size: number; sessions: Session[] };

export type DraftSet = {
  repMin: number; repMax: number; targetRpe: number | null; restSeconds: number | null; tempo: string | null; loadText: string | null; notes: string | null;
  repsSource: Provenance; rpeSource: Provenance; restSource: Provenance; repsText: string | null; restText: string | null;
  percent1Rm: string | null; rir: string | null; warmup: boolean;
};
export type DraftExercise = { lineId: string; sourceName: string; exerciseId: string | null; notes: string | null; sets: DraftSet[]; sequenceGroup: string; substitutions: string[] };
export type DraftWorkout = { lineId: string; week: number; name: string; focus: string | null; notes: string | null; exercises: DraftExercise[]; block: string | null; phase: string | null; phaseWeek: number; isRestDay: boolean };
export type ImportDraft = { programName: string; description: string | null; workouts: DraftWorkout[] };
export type ImportView = {
  id: string; status: 'pending' | 'ready' | 'failed' | 'accepted' | 'discarded';
  fileName: string; pages: number; error: string; created: string; model: string; stage: 'outline' | 'extract' | 'done'; chunksDone: number; chunksTotal: number; currentChunkLabel: string | null; unresolvedCount: number;
  draft: ImportDraft | null; unresolved: { lineId: string; sourceName: string }[]; acceptable: boolean; programId: string | null;
};

export type Bootstrap = {
  account: Account; preferences: Preferences; exercises: Exercise[]; templates: Template[];
  programs: ProgramSummary[]; activeProgram: ProgramSummary | null; activeWorkout: Session | null;
  imports: ImportView[]; history: HistoryPage; aiImportsRemaining: number;
};

/// What the shell reports about the connection to the server. Nothing about workout data is
/// stored on the device, so these states are the whole truth about whether work is safe.
export type SaveState = 'connecting' | 'idle' | 'saving' | 'saved' | 'failed' | 'signed-out' | 'offline';
