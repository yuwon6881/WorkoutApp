import type { PdfExtraction } from './pdfText';
import type { Bootstrap, DraftWorkout, ExerciseClearPreview, ExerciseInsight, HistoryPage, ImportDraft, ImportView, Preferences, ProgressSummary, Program, ProgramSummary, Session, Template, SubstitutionCandidate, TemplateSubstitutionResult, WorkoutActivityItem } from '../types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
  /// A conflict means someone else's newer work is on the server; the caller must refresh
  /// rather than retry, so it is never swallowed into a generic failure.
  get conflict() { return this.status === 409; }
  get signedOut() { return this.status === 401; }
  get offline() { return this.status === 0; }
}

async function call<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method, signal, credentials: 'same-origin', cache: 'no-store',
      headers: {
        // The custom header is what the server checks alongside Origin, so a cross-site form
        // post cannot reach a mutating endpoint.
        'X-Workout-Request': '1',
        ...(body instanceof FormData ? {} : body instanceof Uint8Array ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {})
        , ...extraHeaders
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : body instanceof Uint8Array ? body as BodyInit : JSON.stringify(body)
    });
  } catch {
    throw new ApiError('No connection to the server. Your workout needs a connection to save.', 0);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text ? safeParse(text) : null;
  if (!response.ok) throw new ApiError(payload?.message ?? 'Something went wrong. Try again.', response.status);
  return payload as T;
}

/// Posts JSON gzipped where the browser can compress a stream, and as plain JSON where it
/// cannot. The server accepts both, so an older browser stays able to import a smaller document
/// rather than losing the feature entirely.
async function callCompressed<T>(path: string, body: unknown): Promise<T> {
  const json = JSON.stringify(body);
  if (typeof CompressionStream === 'undefined') return call<T>(path, 'POST', body);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return call<T>(path, 'POST', compressed, undefined, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
}

function safeParse(text: string): { message?: string } & Record<string, unknown> {
  try { return JSON.parse(text); } catch { return { message: 'The server sent a response this app could not read.' }; }
}

export const api = {
  logout: () => call<void>('/api/auth/logout', 'POST'),

  bootstrap: (signal?: AbortSignal) => call<Bootstrap>('/api/bootstrap', 'GET', undefined, signal),
  activity: (from: string, to: string, timeZoneOrSignal?: string | AbortSignal, signal?: AbortSignal) => {
    const timeZone = typeof timeZoneOrSignal === 'string' ? timeZoneOrSignal : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sig = timeZoneOrSignal instanceof AbortSignal ? timeZoneOrSignal : signal;
    return call<WorkoutActivityItem[]>(`/api/workouts/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timeZone=${encodeURIComponent(timeZone)}`, 'GET', undefined, sig);
  },
  preferences: (input: Preferences) => call<Preferences>('/api/preferences', 'PUT', input),
  substitutionCandidates: (input: { exerciseId?: string | null; name?: string; imported?: string[]; query?: string } = {}) => {
    const params = new URLSearchParams(); if (input.exerciseId) params.set('exerciseId', input.exerciseId); if (input.name) params.set('name', input.name);
    if (input.imported?.length) params.set('imported', input.imported.join('|')); if (input.query) params.set('q', input.query);
    return call<SubstitutionCandidate[]>(`/api/exercises/substitutions?${params.toString()}`);
  },
  createCustomExercise: (input: { name: string; muscle?: string; equipment?: string; cue?: string; loadStepKg: number; loadModel: string; movementPattern?: string }) => call<unknown>('/api/exercises/custom', 'POST', input),
  deleteCustomExercise: (id: string) => call<void>(`/api/exercises/custom/${id}`, 'DELETE'),
  exerciseInsight: (id: string, range = '3m', page = 0, size = 20, signal?: AbortSignal) => call<ExerciseInsight>(`/api/exercises/${id}/insight?range=${range}&page=${page}&size=${size}`, 'GET', undefined, signal),
  exerciseClearPreview: (id: string, signal?: AbortSignal) => call<ExerciseClearPreview>(`/api/exercises/${id}/clear-preview`, 'GET', undefined, signal),
  clearExerciseHistory: (id: string) => call<ExerciseClearPreview>(`/api/exercises/${id}/clear-history`, 'POST'),

  templates: () => call<Template[]>('/api/templates'),
  getTemplate: (id: string) => call<Template>(`/api/templates/${id}`),
  createTemplate: (input: unknown) => call<Template>('/api/templates', 'POST', input),
  updateTemplate: (id: string, input: unknown) => call<Template>(`/api/templates/${id}`, 'PUT', input),
  restoreTemplate: (id: string, revision?: number) => call<Template>(`/api/templates/${id}/restore`, 'POST', { revision }),
  substituteTemplateExercise: (id: string, input: { templateExerciseId?: string; slotKey?: string; replacementExerciseId?: string | null; replacementName: string; scope?: 'slot' | 'phase'; revision?: number; idempotencyId?: string }) => call<TemplateSubstitutionResult>(`/api/templates/${id}/substitution`, 'POST', input),
  previewTemplateSubstitution: (id: string, input: { templateExerciseId?: string; slotKey?: string; replacementExerciseId?: string | null; replacementName: string; scope?: 'slot' | 'phase'; revision?: number }) => call<TemplateSubstitutionResult>(`/api/templates/${id}/substitution/preview`, 'POST', input),
  restoreTemplateSubstitution: (id: string, input: { templateExerciseId?: string; slotKey?: string; scope?: 'slot' | 'phase'; revision?: number; idempotencyId?: string }) => call<TemplateSubstitutionResult>(`/api/templates/${id}/substitution/restore`, 'POST', input),
  previewRestoreTemplateSubstitution: (id: string, input: { templateExerciseId?: string; slotKey?: string; scope?: 'slot' | 'phase'; revision?: number }) => call<TemplateSubstitutionResult>(`/api/templates/${id}/substitution/restore/preview`, 'POST', input),
  deleteTemplate: (id: string) => call<void>(`/api/templates/${id}`, 'DELETE'),

  programs: () => call<ProgramSummary[]>('/api/programs'),
  getProgram: (id: string) => call<Program>(`/api/programs/${id}`),
  createProgram: (input: unknown) => call<Program>('/api/programs', 'POST', input),
  setProgramActive: (id: string, active: boolean, revision: number) => call<Program>(`/api/programs/${id}/active`, 'POST', { active, revision }),
  skipProgramWorkout: (id: string, templateId: string) => call<Program>(`/api/programs/${id}/workouts/${templateId}/skip`, 'POST'),
  unskipProgramWorkout: (id: string, templateId: string) => call<Program>(`/api/programs/${id}/workouts/${templateId}/skip`, 'DELETE'),
  repeatProgram: (id: string) => call<Program>(`/api/programs/${id}/repeat`, 'POST'),
  deleteProgram: (id: string) => call<void>(`/api/programs/${id}`, 'DELETE'),

  activeWorkout: () => call<Session | null>('/api/workouts/active'),
  getWorkout: (id: string) => call<Session>(`/api/workouts/${id}`),
  startWorkout: (templateId: string | null, name?: string) => call<Session>('/api/workouts', 'POST', { templateId, name }),
  saveWorkout: (id: string, input: unknown) => call<Session>(`/api/workouts/${id}`, 'PUT', input),
  substituteSessionExercise: (id: string, input: { sessionExerciseId: string; replacementExerciseId?: string | null; replacementName: string; revision?: number; idempotencyId?: string }) => call<Session>(`/api/workouts/${id}/substitution`, 'POST', input),
  restoreSessionExercise: (id: string, input: { sessionExerciseId: string; revision?: number; idempotencyId?: string }) => call<Session>(`/api/workouts/${id}/exercises/${input.sessionExerciseId}/restore`, 'POST', input),
  finishWorkout: (id: string, revision: number, retainExerciseSwaps = false) => call<Session>(`/api/workouts/${id}/finish`, 'POST', { revision, retainExerciseSwaps }),
  discardWorkout: (id: string) => call<void>(`/api/workouts/${id}/discard`, 'POST'),
  deleteWorkout: (id: string) => call<void>(`/api/workouts/${id}`, 'DELETE'),
  history: (page: number, size = 20, signal?: AbortSignal) => call<HistoryPage>(`/api/history?page=${page}&size=${size}`, 'GET', undefined, signal),
  progress: (signal?: AbortSignal) => call<ProgressSummary>('/api/progress', 'GET', undefined, signal),
  connectedApps: () => call<{ peer: string; status: string; scopes: string[]; grantedAt: string | null; revokedAt: string | null }[]>('/api/integrations/connected'),
  connectApp: (peer: string, refreshToken: string | null = null) => call<{ peer: string; status: string; scopes: string[] }>('/api/integrations/connected', 'POST', { peer, refreshToken }),
  revokeApp: (peer: string) => call<void>(`/api/integrations/connected/${peer}`, 'DELETE'),
  refreshNutritionContext: (signal?: AbortSignal) => call<{ mode: string; cached: boolean; confirmed: boolean; error: string | null }>('/api/integrations/refresh', 'POST', undefined, signal),

  imports: () => call<ImportView[]>('/api/imports'),
  getImport: (id: string) => call<ImportView>(`/api/imports/${id}`),
  createImport: (source: PdfExtraction) => callCompressed<ImportView>('/api/imports', {
    fileName: source.fileName, pageCount: source.pageCount, pages: source.pages
  }),
  extractImport: (id: string) => call<ImportView>(`/api/imports/${id}/extract`, 'POST'),
  retryImport: (id: string) => call<ImportView>(`/api/imports/${id}/retry`, 'POST'),
  editImport: (id: string, draft: Pick<ImportDraft, 'programName'> | ImportDraft) => call<ImportView>(`/api/imports/${id}`, 'PUT', draft),
  editImportDay: (id: string, day: DraftWorkout) => call<ImportView>(`/api/imports/${id}/days/${day.lineId}`, 'PUT', day),
  restoreImport: (id: string, revision?: number) => call<ImportView>(`/api/imports/${id}/restore`, 'POST', { revision }),
  restoreImportExercise: (id: string, exerciseLineId: string, revision?: number) => call<ImportView>(`/api/imports/${id}/exercises/${exerciseLineId}/restore`, 'POST', { revision }),
  selectImportAlternative: (id: string, alternativeId: string) => call<ImportView>(`/api/imports/${id}/alternative`, 'POST', { alternativeId }),
  acceptImport: (id: string) => call<Program>(`/api/imports/${id}/accept`, 'POST'),
  discardImport: (id: string) => call<void>(`/api/imports/${id}/discard`, 'POST')
};
