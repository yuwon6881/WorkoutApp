import { ApiError } from '../api';

export const AI_CHAT_TIMEOUT_MS = 60_000;

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const AI_ACTION_TYPES = [
  'openWorkout',
  'openExercise',
  'openProgram',
  'openHistory',
  'openActiveWorkout',
  'openAddWorkoutDraft',
] as const;

export type AiActionType = typeof AI_ACTION_TYPES[number];

export interface AiUiAction {
  type: AiActionType;
  payload: Record<string, unknown>;
  actionId?: string | null;
}

export interface AiActionBatch {
  batchId: string;
  actions: AiUiAction[];
  status: 'PendingReview';
}

export interface AiConversationState {
  lastWorkoutIds?: string[] | null;
  lastExerciseSlugs?: string[] | null;
  lastProgramId?: string | null;
}

export interface AiInvocationContext {
  surface: string;
  preset?: string;
  exerciseSlug?: string;
  workoutId?: string;
  timeZone?: string;
}

export interface AiChatResponse {
  reply: string;
  actions: AiUiAction[];
  closeChat: boolean;
  state?: AiConversationState | null;
  conversationId?: string | null;
  conversationVersion?: number;
  historyRedacted?: boolean;
  actionBatch?: AiActionBatch | null;
}

export interface AiConversationSnapshot {
  conversationId: string | null;
  conversationVersion: number;
  messages: AiChatMessage[];
  state: AiConversationState | null;
  historyRedacted?: boolean;
  pendingActionBatches: AiActionBatch[];
}

export interface AiConversationRequest {
  conversationId: string | null;
  conversationVersion: number | null;
  clientTurnId: string;
}

export interface AiChatTurn {
  message: string;
  history: AiChatMessage[];
  state?: AiConversationState | null;
  conversation?: AiConversationRequest;
  context?: AiInvocationContext;
}

export function buildAiChatBody(turn: AiChatTurn) {
  return {
    message: turn.message,
    history: turn.history.slice(-6),
    state: turn.state ?? null,
    conversationId: turn.conversation?.conversationId ?? null,
    conversationVersion: turn.conversation?.conversationVersion ?? null,
    clientTurnId: turn.conversation?.clientTurnId,
    context: turn.context ?? null,
  };
}

const AI_ACTION_TYPE_SET = new Set<string>(AI_ACTION_TYPES);

function normalizeAiAction(value: unknown): AiUiAction | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== 'string' || !AI_ACTION_TYPE_SET.has(candidate.type)) return null;
  if (!candidate.payload || typeof candidate.payload !== 'object' || Array.isArray(candidate.payload)) return null;
  return {
    type: candidate.type as AiActionType,
    payload: candidate.payload as Record<string, unknown>,
    actionId: typeof candidate.actionId === 'string' ? candidate.actionId : null,
  };
}

function normalizeAiActionBatch(value: unknown): AiActionBatch | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.batchId !== 'string' || !Array.isArray(candidate.actions)) return null;
  const actions = candidate.actions.map(normalizeAiAction).filter((action): action is AiUiAction => action !== null);
  if (actions.length === 0) return null;
  return { batchId: candidate.batchId, actions, status: 'PendingReview' };
}

export function normalizeAiChatResponse(data: Partial<AiChatResponse>): AiChatResponse {
  return {
    reply: data.reply || '',
    actions: Array.isArray(data.actions)
      ? data.actions.map(normalizeAiAction).filter((action): action is AiUiAction => action !== null)
      : [],
    closeChat: data.closeChat === true,
    state: data.state ?? null,
    conversationId: typeof data.conversationId === 'string' ? data.conversationId : null,
    conversationVersion: typeof data.conversationVersion === 'number' ? data.conversationVersion : 0,
    historyRedacted: data.historyRedacted === true,
    actionBatch: normalizeAiActionBatch(data.actionBatch),
  };
}

export async function chatWithAi(
  turn: AiChatTurn,
  signal?: AbortSignal,
): Promise<AiChatResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, AI_CHAT_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Workout-Request': '1',
      },
      credentials: 'same-origin',
      body: JSON.stringify(buildAiChatBody(turn)),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(err.reply ?? err.message ?? 'AI is unavailable. Please try again.', res.status);
    }
    const data = await res.json();
    return normalizeAiChatResponse(data);
  } catch (error) {
    if (timedOut && !signal?.aborted) throw new ApiError('The AI took too long to respond. Please try again.', 504);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export async function fetchAiConversation(signal?: AbortSignal): Promise<AiConversationSnapshot> {
  const res = await fetch('/api/ai/conversation', {
    method: 'GET',
    headers: { 'X-Workout-Request': '1' },
    credentials: 'same-origin',
    signal,
  });

  if (!res.ok) {
    throw new ApiError('The Ask AI conversation could not be loaded.', res.status);
  }

  const data = await res.json();
  const messages = Array.isArray(data.messages)
    ? data.messages.filter((m: unknown): m is AiChatMessage =>
      typeof m === 'object' && m !== null && 'role' in m && 'content' in m)
    : [];

  return {
    conversationId: typeof data.conversationId === 'string' ? data.conversationId : null,
    conversationVersion: typeof data.conversationVersion === 'number' ? data.conversationVersion : 0,
    messages,
    state: data.state ?? null,
    historyRedacted: data.historyRedacted === true,
    pendingActionBatches: Array.isArray(data.pendingActionBatches)
      ? (data.pendingActionBatches as unknown[])
        .map(normalizeAiActionBatch)
        .filter((batch): batch is AiActionBatch => batch !== null)
      : [],
  };
}

export async function resolveAiActionBatch(
  batchId: string,
  resolution: 'accepted' | 'dismissed',
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/ai/action-batches/${encodeURIComponent(batchId)}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workout-Request': '1',
    },
    credentials: 'same-origin',
    body: JSON.stringify({ resolution }),
    signal,
  });
  if (!res.ok) {
    throw new ApiError('The AI review action could not be updated.', res.status);
  }
}

export async function deleteAiConversation(
  conversationId: string | null,
  expectedVersion: number | null,
  signal?: AbortSignal,
): Promise<void> {
  const query = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}${expectedVersion != null ? `&expectedVersion=${expectedVersion}` : ''}`
    : '';
  const res = await fetch(`/api/ai/conversation${query}`, {
    method: 'DELETE',
    headers: { 'X-Workout-Request': '1' },
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) {
    throw new ApiError('The current conversation could not be reset.', res.status);
  }
}
