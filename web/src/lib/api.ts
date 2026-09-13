import type { Bootstrap, HistoryPage, ImportDraft, ImportView, Preferences, Program, Session, Template } from '../types';

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
  status: () => call<{ registrationOpen: boolean }>('/api/auth/status'),
  register: (username: string, password: string) => call<{ id: string; username: string }>('/api/auth/register', 'POST', { username, password }),
  login: (username: string, password: string) => call<{ id: string; username: string }>('/api/auth/login', 'POST', { username, password }),
  logout: () => call<void>('/api/auth/logout', 'POST'),
  changePassword: (currentPassword: string, newPassword: string) => call<void>('/api/auth/password', 'POST', { currentPassword, newPassword }),

  bootstrap: (signal?: AbortSignal) => call<Bootstrap>('/api/bootstrap', 'GET', undefined, signal),
  preferences: (input: Preferences) => call<Preferences>('/api/preferences', 'PUT', input),
  exportAccount: () => call<unknown>('/api/export'),

  templates: () => call<Template[]>('/api/templates'),
  createTemplate: (input: unknown) => call<Template>('/api/templates', 'POST', input),
  updateTemplate: (id: string, input: unknown) => call<Template>(`/api/templates/${id}`, 'PUT', input),
  deleteTemplate: (id: string) => call<void>(`/api/templates/${id}`, 'DELETE'),

  programs: () => call<Program[]>('/api/programs'),
  createProgram: (input: unknown) => call<Program>('/api/programs', 'POST', input),
  setProgramActive: (id: string, active: boolean, revision: number) => call<Program>(`/api/programs/${id}/active`, 'POST', { active, revision }),
  deleteProgram: (id: string) => call<void>(`/api/programs/${id}`, 'DELETE'),

  activeWorkout: () => call<Session | null>('/api/workouts/active'),
  startWorkout: (templateId: string | null, name?: string) => call<Session>('/api/workouts', 'POST', { templateId, name }),
  saveWorkout: (id: string, input: unknown) => call<Session>(`/api/workouts/${id}`, 'PUT', input),
  finishWorkout: (id: string, revision: number) => call<Session>(`/api/workouts/${id}/finish`, 'POST', { revision }),
  discardWorkout: (id: string) => call<void>(`/api/workouts/${id}/discard`, 'POST'),
  deleteWorkout: (id: string) => call<void>(`/api/workouts/${id}`, 'DELETE'),
  history: (page: number, size = 20) => call<HistoryPage>(`/api/history?page=${page}&size=${size}`),

  imports: () => call<ImportView[]>('/api/imports'),
  getImport: (id: string) => call<ImportView>(`/api/imports/${id}`),
  uploadImport: (file: File) => { const form = new FormData(); form.append('file', file); return call<ImportView>('/api/imports', 'POST', form); },
  editImport: (id: string, draft: ImportDraft) => call<ImportView>(`/api/imports/${id}`, 'PUT', draft),
  rematchImport: (id: string) => call<ImportView>(`/api/imports/${id}/rematch`, 'POST'),
  acceptImport: (id: string) => call<Program>(`/api/imports/${id}/accept`, 'POST'),
  discardImport: (id: string) => call<void>(`/api/imports/${id}/discard`, 'POST')
};
