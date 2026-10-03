import {fetchWithAvailabilityRecovery} from './availabilityRecovery';
import { integrationGeneration, signalIntegrationPending } from './integrationDispatch';
import type { ExerciseLoadSettings, LoadRule, LoadSettingsOverview } from './exerciseLoads';
import type { PdfExtraction } from './pdfText';
import { sharedReads } from './readCoordinator';
import type { Exercise, HistorySummaryPage, ShellBootstrap, TrackingMode, Unit } from '../types';
import type { Bootstrap, CustomExerciseCreated, DraftWorkout, ExerciseClearPreview, ExerciseInsight, HistoryPage, ImportDraft, ImportStatusView, ImportView, MuscleBalanceRange, MuscleBalanceView, Preferences, ProgressSummary, Program, ProgramDayActionInput, ProgramEditorDocument, ProgramSummary, ProgramWeekResetInput, RestMutationInput, Session, Template, TemplateSubstitutionResult, WatchDevice, WorkoutActivityItem } from '../types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs: number | null = null) { super(message); }
  /// A conflict means someone else's newer work is on the server; the caller must refresh
  /// rather than retry, so it is never swallowed into a generic failure.
  get conflict() { return this.status === 409; }
  get signedOut() { return this.status === 401; }
  get offline() { return this.status === 0; }
}

const requestTimeout = (path: string) => path.startsWith('/api/ai/') || path.startsWith('/api/imports') ? 120000 : path === '/api/integrations/google-health' ? 15000 : 20000;
const readPriority = (path: string) => path.startsWith('/api/bootstrap') || path.startsWith('/api/auth/') ? 0
  : path.startsWith('/api/integrations/') || path.startsWith('/api/notifications/') ? 2 : 1;

async function coordinateRead<T>(key: string, path: string, signal: AbortSignal | undefined, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('The service is taking longer than expected. Try again shortly.', 'TimeoutError')), requestTimeout(path));
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try { return await sharedReads.run(key, combined, load, readPriority(path)); }
  catch (error) {
    if (deadline.signal.aborted && !signal?.aborted) throw new ApiError(deadline.signal.reason.message, 0);
    throw error;
  } finally { clearTimeout(timer); }
}

export async function call<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<T> {
  const load = async (sharedSignal?: AbortSignal) => (await requestWithMeta<T>(path, method, body, sharedSignal, extraHeaders)).data as T;
  return method === 'GET' ? coordinateRead(path + ':' + JSON.stringify(extraHeaders ?? {}), path, signal, load) : load(signal);
}

async function callWithMeta<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal,
  extraHeaders?: Record<string, string>): Promise<{ data: T | null; notModified: boolean; etag: string | null }> {
  const load = (sharedSignal?: AbortSignal) => requestWithMeta<T>(path, method, body, sharedSignal, extraHeaders);
  return method === 'GET' ? coordinateRead(path + ':' + JSON.stringify(extraHeaders ?? {}), path, signal, load) : load(signal);
}

async function requestWithMeta<T>(path: string, method: string, body?: unknown, signal?: AbortSignal,
  extraHeaders?: Record<string, string>): Promise<{ data: T | null; notModified: boolean; etag: string | null }> {
  let response: Response;
  const integrationEpoch = integrationGeneration();
  try {
    response = await fetchWithAvailabilityRecovery(path, {
      method, signal, credentials: 'same-origin', cache: 'no-store',
      headers: {
        'X-Workout-Request': '1',
        ...(method === 'GET' ? {} : { 'X-Fitness-Integration-Dispatch': 'deferred' }),
        ...(body instanceof FormData ? {} : body instanceof Uint8Array ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : body instanceof Uint8Array ? body as BodyInit : JSON.stringify(body)
    }, method === 'GET' && (path.startsWith('/api/bootstrap') || path === '/api/integrations/google-health')
      || method === 'POST' && path === '/api/integrations/google-health/sync-data', requestTimeout(path));
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new ApiError(error.message, 0);
    throw new ApiError('No connection to the server. Your workout needs a connection to save.', 0);
  }
  const etag = response.headers.get('ETag');
  if (response.status === 304) return { data: null, notModified: true, etag };
  const text = response.status === 204 ? '' : await response.text();
  const payload = text ? safeParse(text, response.status) : null;
  if (!response.ok) {
    const raw = response.headers.get('Retry-After');
    const seconds = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
    const date = raw !== null ? Date.parse(raw) : NaN;
    const retryAfterMs = response.status === 429 ? (seconds !== null ? seconds * 1000
      : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 5000) : null;
    throw new ApiError(payload?.message ?? 'Something went wrong. Try again.', response.status, retryAfterMs);
  }
  if (response.headers.get('X-Fitness-Integration-Pending') === '1') signalIntegrationPending(integrationEpoch);
  return { data: (response.status === 204 ? undefined : payload) as T, notModified: false, etag };
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

function safeParse(text: string, status: number): { message?: string } & Record<string, unknown> {
  try { return JSON.parse(text); } catch { return { message: [429,502,503,504].includes(status)?'The service is temporarily unavailable. Try again shortly.':'The server sent a response this app could not read.' }; }
}

export const api = {
  recentExerciseSets: async (id: string, signal?: AbortSignal): Promise<import('../types').RecentExerciseSession[]> => {
    try { return await call(`/api/exercises/${encodeURIComponent(id)}/recent-sets?limit=3`, 'GET', undefined, signal); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      return (await import('./readCompatibility')).recentSets(id, signal);
    }
  },
  logout: () => call<void>('/api/auth/logout', 'POST'),

  watchDevices: () => call<WatchDevice[]>('/api/watch/devices'),
  approveWatchPairing: (code: string) => call<WatchDevice>('/api/watch/pairing/approve', 'POST', { code }),
  revokeWatchDevice: (id: string) => call<void>(`/api/watch/devices/${encodeURIComponent(id)}`, 'DELETE'),

  bootstrap: (signal?: AbortSignal) => call<Bootstrap>('/api/bootstrap', 'GET', undefined, signal),
  shell: (signal?: AbortSignal) => call<ShellBootstrap>('/api/bootstrap/shell', 'GET', undefined, signal),
  launch: async (signal?: AbortSignal): Promise<ShellBootstrap> => {
    let launch: ShellBootstrap;
    try { launch = await call<ShellBootstrap>('/api/bootstrap/launch', 'GET', undefined, signal); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      return api.shell(signal);
    }
    return { ...launch, activeProgram: launch.activeProgram ? { ...launch.activeProgram, days: [], completedTemplateIds: [] } : null,
      imports: launch.imports.map(row => ({ ...row, draft: null, unresolved: [], acceptable: false, currentChunkLabel: null })) };
  },
  exercises: (signal?: AbortSignal) => call<Exercise[]>('/api/exercises', 'GET', undefined, signal),
  historySummaries: (beforeAt?: string | null, beforeId?: string | null, signal?: AbortSignal) =>
    call<HistorySummaryPage>(`/api/history/summaries?size=20${beforeAt && beforeId ? `&beforeAt=${encodeURIComponent(beforeAt)}&beforeId=${encodeURIComponent(beforeId)}` : ''}`, 'GET', undefined, signal),
  activity: (from: string, to: string, timeZoneOrSignal?: string | AbortSignal, signal?: AbortSignal) => {
    const timeZone = typeof timeZoneOrSignal === 'string' ? timeZoneOrSignal : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sig = timeZoneOrSignal instanceof AbortSignal ? timeZoneOrSignal : signal;
    return call<WorkoutActivityItem[]>(`/api/workouts/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timeZone=${encodeURIComponent(timeZone)}`, 'GET', undefined, sig);
  },
  preferences: (input: Preferences) => call<Preferences>('/api/preferences', 'PUT', input),
  restAlertStatus: (deviceId: string, sessionId?: string) => call<{ configured: boolean; registered: boolean; currentGeneration: string | null; message: string }>(
    `/api/notifications/rest-alerts?deviceId=${encodeURIComponent(deviceId)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ''}`),
  registerRestAlertDevice: (deviceId: string, fcmToken: string) => call<{ configured: boolean; registered: boolean; currentGeneration: string | null; message: string }>(
    '/api/notifications/rest-alerts/subscription', 'POST', { deviceId, fcmToken }),
  unregisterRestAlertDevice: (deviceId: string) => call<void>(`/api/notifications/rest-alerts/subscription/${encodeURIComponent(deviceId)}`, 'DELETE'),
  scheduleRestAlert: (sessionId: string, input: { deviceId: string; generation: string; deadline: string; expectedGeneration: string | null }) =>
    call<{ scheduled: boolean; generation: string | null; message: string }>(`/api/workouts/${encodeURIComponent(sessionId)}/rest-alert`, 'POST', input),
  cancelRestAlert: (sessionId: string, input: { deviceId: string; generation: string }) =>
    call<void>(`/api/workouts/${encodeURIComponent(sessionId)}/rest-alert`, 'DELETE', input),
  // Load rules are read and typed in the unit on screen, which can be ahead of a unit switch still being saved.
  exerciseLoadSettings: (id: string, unit: Unit, signal?: AbortSignal) =>
    call<ExerciseLoadSettings>(`/api/exercises/${id}/load-settings?unit=${unit}`, 'GET', undefined, signal),
  saveExerciseLoadSettings: (id: string, input: LoadRule & { revision: number; unit: Unit }) => call<ExerciseLoadSettings>(`/api/exercises/${id}/load-settings`, 'PUT', input),
  loadSettings: (unit: Unit, signal?: AbortSignal) => call<LoadSettingsOverview>(`/api/load-settings?unit=${unit}`, 'GET', undefined, signal),
  saveEquipmentLoad: (group: string, input: LoadRule & { revision: number; unit: Unit }) =>
    call<LoadSettingsOverview>(`/api/load-settings/equipment/${encodeURIComponent(group)}`, 'PUT', input),
  createCustomExercise: (input: { name: string; muscle?: string; secondaryMuscles?: string[]; equipment?: string; cue?: string; loadStepKg?: number; loadModel: string; movementPattern?: string; category?: string; trackingMode?: TrackingMode }) => call<CustomExerciseCreated>('/api/exercises/custom', 'POST', input),
  deleteCustomExercise: (id: string) => call<void>(`/api/exercises/custom/${id}`, 'DELETE'),
  exerciseInsight: (id: string, range = '3m', page = 0, size = 20, signal?: AbortSignal) => call<ExerciseInsight>(`/api/exercises/${id}/insight?range=${range}&page=${page}&size=${size}`, 'GET', undefined, signal),
  exerciseClearPreview: (id: string, signal?: AbortSignal) => call<ExerciseClearPreview>(`/api/exercises/${id}/clear-preview`, 'GET', undefined, signal),
  clearExerciseHistory: (id: string) => call<ExerciseClearPreview>(`/api/exercises/${id}/clear-history`, 'POST'),

  createProgramFromEditor: (draft: ProgramEditorDocument, idempotencyId: string) => call<Program>('/api/programs/from-editor', 'POST', { draft, idempotencyId }),
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
  skipProgramWorkout: (id: string, templateId: string, input: ProgramDayActionInput) => call<Program>(`/api/programs/${id}/workouts/${templateId}/skip`, 'POST', input),
  passProgramRestDay: (id: string, templateId: string, input: ProgramDayActionInput) => call<Program>(`/api/programs/${id}/days/${templateId}/pass`, 'POST', input),
  resetProgramWeek: (id: string, input: ProgramWeekResetInput) => call<Program>(`/api/programs/${id}/week/reset`, 'POST', input),
  repeatProgram: (id: string) => call<Program>(`/api/programs/${id}/repeat`, 'POST', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  deleteProgram: (id: string) => call<void>(`/api/programs/${id}`, 'DELETE'),

  activeWorkout: () => call<Session | null>('/api/workouts/active'),
  getWorkout: (id: string, signal?: AbortSignal) => call<Session>(`/api/workouts/${id}`, 'GET', undefined, signal),
  startWorkout: (templateId: string | null, name?: string) => call<Session>('/api/workouts', 'POST', { templateId, name }),
  saveWorkout: (id: string, input: unknown) => call<Session>(`/api/workouts/${id}`, 'PUT', input),
  patchWorkoutSet: (sessionId: string, setId: string, input: { revision: number; mutationId: string; weightKg?: number | null; reps?: number | null; rpe?: number | null; rir?: string | null; done?: boolean; warmup?: boolean; resistanceMode?: string; rest?: RestMutationInput | null }) => call<Session>(`/api/workouts/${sessionId}/sets/${setId}`, 'PATCH', input),
  mutateWorkoutRest: (sessionId: string, input: RestMutationInput) => call<Session>(`/api/workouts/${sessionId}/rest`, 'POST', input),
  substituteSessionExercise: (id: string, input: { sessionExerciseId: string; replacementExerciseId?: string | null; replacementName: string; revision?: number; idempotencyId?: string }) => call<Session>(`/api/workouts/${id}/substitution`, 'POST', input),
  restoreSessionExercise: (id: string, input: { sessionExerciseId: string; revision?: number; idempotencyId?: string }) => call<Session>(`/api/workouts/${id}/exercises/${input.sessionExerciseId}/restore`, 'POST', input),
  restoreWorkout: (id: string, input: { revision?: number; idempotencyId?: string }) => call<Session>(`/api/workouts/${id}/restore`, 'POST', input),
  pauseWorkout: (id: string, input: { revision: number; mutationId: string; occurredAt: string }) => call<Session>(`/api/workouts/${id}/pause`, 'POST', input),
  resumeWorkout: (id: string, input: { revision: number; mutationId: string; occurredAt: string }) => call<Session>(`/api/workouts/${id}/resume`, 'POST', input),
  finishWorkout: (id: string, input: { revision: number; retainExerciseSwaps?: boolean; mutationId?: string; finishedAt?: string }) => call<Session>(`/api/workouts/${id}/finish`, 'POST', input),
  discardWorkout: (id: string) => call<void>(`/api/workouts/${id}/discard`, 'POST'),
  deleteWorkout: (id: string) => call<void>(`/api/workouts/${id}`, 'DELETE'),
  history: (page: number, size = 20, signal?: AbortSignal) => call<HistoryPage>(`/api/history?page=${page}&size=${size}`, 'GET', undefined, signal),
  historyCursor: (beforeAt?: string, beforeId?: string, size = 20, signal?: AbortSignal) => call<{ sessions: import('../types').Session[]; nextBeforeAt: string | null; nextBeforeId: string | null }>(`/api/history/cursor?size=${size}${beforeAt ? `&beforeAt=${encodeURIComponent(beforeAt)}` : ''}${beforeId ? `&beforeId=${encodeURIComponent(beforeId)}` : ''}`, 'GET', undefined, signal),
  progress: (signal?: AbortSignal) => call<ProgressSummary>('/api/progress', 'GET', undefined, signal),
  muscleBalance: (range: MuscleBalanceRange, timeZone: string, signal?: AbortSignal) => call<MuscleBalanceView>(`/api/progress/muscles?range=${encodeURIComponent(range)}&timeZone=${encodeURIComponent(timeZone)}`, 'GET', undefined, signal),
  connectedApps: () => call<{ peer: string; status: string; connectionState: string; canDisconnect: boolean; syncWarning: boolean; scopes: string[]; grantedAt: string | null; revokedAt: string | null }[]>('/api/integrations/connected'),
  revokeApp: (peer: string) => call<void>(`/api/integrations/connected/${peer}`, 'DELETE'),
  refreshNutritionContext: (signal?: AbortSignal) => call<{ mode: string; cached: boolean; confirmed: boolean; error: string | null }>('/api/integrations/refresh', 'POST', undefined, signal),
  googleHealthStatus: (signal?: AbortSignal) => call<import('./googleHealth').GoogleHealthSyncResult>('/api/integrations/google-health', 'GET', undefined, signal,
    {'X-Workout-Google-Health-Status-Only':'1'}),
  googleHealthSyncData: (signal?: AbortSignal) => call<import('./googleHealth').GoogleHealthSyncResult>('/api/integrations/google-health/sync-data', 'POST', {}, signal),
  connectGoogleHealth: (input: { syncWorkout?: boolean }) => call<{ authUrl: string }>('/api/integrations/google-health/connect', 'POST', input),
  disconnectGoogleHealth: () => call<import('./googleHealth').GoogleHealthSyncResult>('/api/integrations/google-health/disconnect', 'POST'),
  setGoogleHealthWorkoutSyncPreference: (input: { enabled: boolean; revision: number }) => call<import('./googleHealth').GoogleHealthWorkoutSyncStatus>('/api/integrations/google-health/workout-sync/preference', 'POST', input),
  recoverGoogleHealthWorkoutSync: (input: { workoutSessionId?: string }) => call<import('./googleHealth').GoogleHealthWorkoutSyncStatus>('/api/integrations/google-health/workout-sync/recover', 'POST', input),

  imports: () => call<ImportView[]>('/api/imports'),
  getImport: (id: string) => call<ImportView>(`/api/imports/${id}`),
  getImportStatus: (id: string) => call<ImportStatusView>(`/api/imports/${id}/status`),
  getImportStatusMeta: (id: string, etag?: string, signal?: AbortSignal) => callWithMeta<ImportStatusView>(`/api/imports/${id}/status`, 'GET', undefined, signal, etag ? { 'If-None-Match': etag } : undefined),
  createImport: (source: PdfExtraction) => callCompressed<ImportView>('/api/imports', {
    fileName: source.fileName, pageCount: source.pageCount, pages: source.pages, links: source.links
  }),
  extractImport: (id: string) => call<ImportView>(`/api/imports/${id}/extract`, 'POST'),
  retryImport: (id: string) => call<ImportView>(`/api/imports/${id}/retry`, 'POST'),
  editImport: (id: string, draft: Pick<ImportDraft, 'programName'> | ImportDraft, revision?: number) => call<ImportView>(`/api/imports/${id}`, 'PUT', revision == null ? draft : { ...draft, revision }),
  editImportDay: (id: string, day: DraftWorkout, revision?: number) => call<ImportView>(`/api/imports/${id}/days/${day.lineId}`, 'PUT', revision == null ? day : { ...day, revision }),
  editImportDays: (id: string, days: DraftWorkout[], revision?: number) => call<ImportView>(`/api/imports/${id}/days`, 'PUT', { days, revision }),
  restoreImport: (id: string, revision?: number) => call<ImportView>(`/api/imports/${id}/restore`, 'POST', { revision }),
  restoreImportExercise: (id: string, exerciseLineId: string, revision?: number) => call<ImportView>(`/api/imports/${id}/exercises/${exerciseLineId}/restore`, 'POST', { revision }),
  selectImportAlternative: (id: string, alternativeId: string) => call<ImportView>(`/api/imports/${id}/alternative`, 'POST', { alternativeId }),
  acceptImport: (id: string) => call<Program>(`/api/imports/${id}/accept`, 'POST'),
  discardImport: (id: string) => call<void>(`/api/imports/${id}/discard`, 'POST')
};
