import type { Bootstrap, DraftWorkout, HistoryPage, ImportDraft, ImportView, Preferences, ProgressSummary, Program, ProgramSummary, Session, Template } from '../types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
  /// A conflict means someone else's newer work is on the server; the caller must refresh
  /// rather than retry, so it is never swallowed into a generic failure.
  get conflict() { return this.status === 409; }
  get signedOut() { return this.status === 401; }
  get offline() { return this.status === 0; }
}

async function call<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method, signal, credentials: 'same-origin', cache: 'no-store',
      headers: {
        // The custom header is what the server checks alongside Origin, so a cross-site form
        // post cannot reach a mutating endpoint.
        'X-Workout-Request': '1',
        ...(body instanceof FormData ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
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

function safeParse(text: string): { message?: string } & Record<string, unknown> {
  try { return JSON.parse(text); } catch { return { message: 'The server sent a response this app could not read.' }; }
}

export const api = {
  logout: () => call<void>('/api/auth/logout', 'POST'),

  bootstrap: (signal?: AbortSignal) => call<Bootstrap>('/api/bootstrap', 'GET', undefined, signal),
  preferences: (input: Preferences) => call<Preferences>('/api/preferences', 'PUT', input),
  exportAccount: () => call<unknown>('/api/export'),

  templates: () => call<Template[]>('/api/templates'),
  getTemplate: (id: string) => call<Template>(`/api/templates/${id}`),
  createTemplate: (input: unknown) => call<Template>('/api/templates', 'POST', input),
  updateTemplate: (id: string, input: unknown) => call<Template>(`/api/templates/${id}`, 'PUT', input),
  deleteTemplate: (id: string) => call<void>(`/api/templates/${id}`, 'DELETE'),

  programs: () => call<ProgramSummary[]>('/api/programs'),
  getProgram: (id: string) => call<Program>(`/api/programs/${id}`),
  createProgram: (input: unknown) => call<Program>('/api/programs', 'POST', input),
  scheduleProgram: (id: string, input: { anchor: string; slots: { templateId: string; weekday: number }[]; revision: number }) => call<Program>(`/api/programs/${id}/schedule`, 'POST', input),
  setProgramActive: (id: string, active: boolean, revision: number) => call<Program>(`/api/programs/${id}/active`, 'POST', { active, revision }),
  deleteProgram: (id: string) => call<void>(`/api/programs/${id}`, 'DELETE'),

  activeWorkout: () => call<Session | null>('/api/workouts/active'),
  startWorkout: (templateId: string | null, name?: string) => call<Session>('/api/workouts', 'POST', { templateId, name }),
  saveWorkout: (id: string, input: unknown) => call<Session>(`/api/workouts/${id}`, 'PUT', input),
  finishWorkout: (id: string, revision: number) => call<Session>(`/api/workouts/${id}/finish`, 'POST', { revision }),
  discardWorkout: (id: string) => call<void>(`/api/workouts/${id}/discard`, 'POST'),
  deleteWorkout: (id: string) => call<void>(`/api/workouts/${id}`, 'DELETE'),
  history: (page: number, size = 20) => call<HistoryPage>(`/api/history?page=${page}&size=${size}`),
  progress: () => call<ProgressSummary>('/api/progress'),
  connectedApps: () => call<{ peer: string; status: string; scopes: string[]; grantedAt: string | null; revokedAt: string | null }[]>('/api/integrations/connected'),
  connectApp: (peer: string, refreshToken: string | null = null) => call<{ peer: string; status: string; scopes: string[] }>('/api/integrations/connected', 'POST', { peer, refreshToken }),
  revokeApp: (peer: string) => call<void>(`/api/integrations/connected/${peer}`, 'DELETE'),
  refreshNutritionContext: () => call<{ mode: string; cached: boolean; confirmed: boolean; error: string | null }>('/api/integrations/refresh', 'POST'),

  imports: () => call<ImportView[]>('/api/imports'),
  getImport: (id: string) => call<ImportView>(`/api/imports/${id}`),
  uploadImport: (file: File) => { const form = new FormData(); form.append('file', file); return call<ImportView>('/api/imports', 'POST', form); },
  extractImport: (id: string, file: File) => { const form = new FormData(); form.append('file', file); return call<ImportView>(`/api/imports/${id}/extract`, 'POST', form); },
  editImport: (id: string, draft: Pick<ImportDraft, 'programName' | 'description'>) => call<ImportView>(`/api/imports/${id}`, 'PUT', draft),
  editImportDay: (id: string, day: DraftWorkout) => call<ImportView>(`/api/imports/${id}/days/${day.lineId}`, 'PUT', day),
  rematchImport: (id: string) => call<ImportView>(`/api/imports/${id}/rematch`, 'POST'),
  acceptImport: (id: string) => call<Program>(`/api/imports/${id}/accept`, 'POST'),
  discardImport: (id: string) => call<void>(`/api/imports/${id}/discard`, 'POST')
};
