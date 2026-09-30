import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { deleteAiConversation, fetchAiConversation, resolveAiActionBatch,
  type AiActionBatch, type AiChatMessage, type AiConversationState, type AiInvocationContext,
  type AiUiAction } from '../lib/api/ai';
import { streamChatWithAi } from '../lib/api/aiStream';
import type { PendingTurnState } from './ai/AiPendingReply';

export interface AiInvocationRequest {
  id: number;
  message?: string;
  preset?: string;
  exerciseSlug?: string;
  workoutId?: string;
  context?: AiInvocationContext;
}
interface Options {
  isOpen: boolean;
  onClose: () => void;
  onActions: (actions: AiUiAction[]) => void | Promise<void>;
  defaultContext: AiInvocationContext;
  invocation?: AiInvocationRequest | null;
  onInvocationConsumed?: () => void;
}
interface FailedTurn { text: string; clientTurnId: string; context: AiInvocationContext }
const describeError = (error: unknown): string => error instanceof ApiError
  ? error.message : 'Unable to connect. Your conversation is retained; please try again.';

export function useAiConversation({ isOpen, onClose, onActions, defaultContext, invocation, onInvocationConsumed }: Options) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState('');
  const [lastFailedTurn, setLastFailedTurn] = useState<FailedTurn | null>(null);
  const [pendingReply, setPendingReply] = useState<PendingTurnState | null>(null);
  const [hasConversation, setHasConversation] = useState(false);
  const [pendingActionBatches, setPendingActionBatches] = useState<AiActionBatch[]>([]);
  const identity = useRef<{ id: string | null; version: number; state: AiConversationState | null }>({ id: null, version: 0, state: null });
  const hydrated = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const activeRequest = useRef<AbortController | null>(null);
  const activeTurn = useRef<FailedTurn | null>(null);
  const hydration = useRef<AbortController | null>(null);
  const consumedInvocation = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRequest.current?.abort(); hydration.current?.abort(); };
  }, []);

  const hydrate = useCallback(async () => {
    hydration.current?.abort();
    const controller = new AbortController();
    hydration.current = controller;
    setIsHydrating(true);
    setError('');
    try {
      const snapshot = await fetchAiConversation(controller.signal);
      if (controller.signal.aborted || !mounted.current) return false;
      identity.current = { id: snapshot.conversationId, version: snapshot.conversationVersion, state: snapshot.state };
      setMessages(snapshot.messages);
      setPendingActionBatches(snapshot.pendingActionBatches ?? []);
      setHasConversation(snapshot.conversationId !== null);
      hydrated.current = true;
      return true;
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) setError(describeError(failure));
      return false;
    } finally {
      if (hydration.current === controller && mounted.current) {
        hydration.current = null;
        setIsHydrating(false);
      }
    }
  }, []);

  useEffect(() => {
    if (isOpen && !busy.current) { hydrated.current = false; void hydrate(); }
    return () => { hydration.current?.abort(); };
  }, [isOpen, hydrate]);

  const stopTurn = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    busy.current = false;
    setIsSending(false);
    setPendingReply(null);
    setError('Generation stopped. Retry the message to collect its result.');
    if (activeTurn.current) setLastFailedTurn(activeTurn.current);
    activeTurn.current = null;
  }, []);

  const resetConversation = useCallback(async () => {
    if (busy.current || !hydrated.current) return;
    busy.current = true;
    setIsResetting(true);
    setError('');
    try {
      await deleteAiConversation(identity.current.id, identity.current.version);
      if (!mounted.current) return;
      identity.current = { id: null, version: 0, state: null };
      setMessages([]);
      setPendingReply(null);
      setLastFailedTurn(null);
      setHasConversation(false);
      setPendingActionBatches([]);
    } catch (failure) {
      if (mounted.current) setError(describeError(failure));
    } finally {
      busy.current = false;
      if (mounted.current) setIsResetting(false);
    }
  }, []);

  const sendMessage = useCallback(async (textToSend?: string, overrideClientTurnId?: string, contextOverride?: AiInvocationContext) => {
    const text = (textToSend ?? input).trim();
    if (!text || text.length > 2000 || busy.current || !hydrated.current || hydration.current) return;
    busy.current = true;
    const controller = new AbortController();
    const turn = { text, clientTurnId: overrideClientTurnId ?? crypto.randomUUID(), context: contextOverride ?? defaultContext };
    activeTurn.current = turn;
    activeRequest.current = controller;
    setIsSending(true);
    setError('');
    setLastFailedTurn(null);
    setPendingReply({ status: 'Thinking', text: '' });
    if (!overrideClientTurnId) { setMessages(prev => [...prev, { role: 'user', content: text }]); setInput(''); }
    const live = () => mounted.current && !controller.signal.aborted && activeRequest.current === controller;
    try {
      const response = await streamChatWithAi({
        message: text, history: [], state: null, context: turn.context,
        conversation: { conversationId: identity.current.id,
          conversationVersion: identity.current.id ? identity.current.version : null, clientTurnId: turn.clientTurnId },
      }, {
        onStatus: status => { if (live()) setPendingReply(prev => ({ status, text: prev?.text ?? '' })); },
        onDelta: delta => { if (live()) setPendingReply(prev => ({ status: prev?.status ?? null, text: (prev?.text ?? '') + delta })); },
        onReset: () => { if (live()) setPendingReply({ status: null, text: '' }); },
      }, controller.signal);
      if (!live()) return;
      identity.current = { id: response.conversationId ?? identity.current.id,
        version: response.conversationVersion ?? identity.current.version, state: response.state ?? null };
      setMessages(prev => [...prev, { role: 'assistant', content: response.reply }]);
      setPendingReply(null);
      setHasConversation(identity.current.id !== null);
      if (response.actionBatch) {
        const batch = response.actionBatch;
        setPendingActionBatches(prev => [...prev.filter(item => item.batchId !== batch.batchId), batch]);
      }
    } catch (failure) {
      if (!live()) return;
      if (failure instanceof ApiError && failure.status === 409) {
        await hydrate();
        if (live()) { setInput(text); setError('The conversation changed. Review the latest messages, then send again.'); }
      } else {
        setError(describeError(failure));
        setLastFailedTurn(turn);
      }
      if (live()) setPendingReply(null);
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        activeTurn.current = null;
        busy.current = false;
        if (mounted.current) setIsSending(false);
      }
    }
  }, [input, defaultContext, hydrate]);

  const resolveBatch = useCallback(async (batchId: string, resolution: 'accepted' | 'dismissed') => {
    if (busy.current) return;
    const batch = pendingActionBatches.find(item => item.batchId === batchId);
    if (!batch) return;
    busy.current = true;
    setIsResolving(true);
    setError('');
    try {
      // Only navigation and editor opening are allowed. Resolve before opening another modal.
      await resolveAiActionBatch(batchId, resolution);
      if (!mounted.current) return;
      setPendingActionBatches(prev => prev.filter(item => item.batchId !== batchId));
      if (resolution === 'accepted') { onClose(); await onActions(batch.actions); }
    } catch (failure) {
      if (mounted.current) setError(describeError(failure));
    } finally { busy.current = false; if (mounted.current) setIsResolving(false); }
  }, [pendingActionBatches, onActions, onClose]);

  useEffect(() => {
    if (!isOpen || !hydrated.current || isHydrating || !invocation || busy.current || consumedInvocation.current === invocation.id) return;
    const text = invocation.message ?? (invocation.preset === 'exercise-progress' ? `Explain my progress on ${invocation.exerciseSlug ?? 'this exercise'}` : invocation.preset === 'workout-detail' ? 'Review my workout' : 'What is my current program schedule?');
    if (!text) return;
    consumedInvocation.current = invocation.id;
    onInvocationConsumed?.();
    void sendMessage(text, undefined, { ...defaultContext, ...invocation.context,
      preset: invocation.preset, exerciseSlug: invocation.exerciseSlug ?? invocation.context?.exerciseSlug, workoutId: invocation.workoutId ?? invocation.context?.workoutId });
  }, [isOpen, isHydrating, invocation, defaultContext, onInvocationConsumed, sendMessage]);

  return { messages, input, setInput, isSending, isHydrating, isResetting, isResolving, error,
    lastFailedTurn, pendingReply, hasConversation, pendingActionBatches, hydrate, sendMessage, stopTurn,
    resetConversation, resolveBatch, retryLastFailedTurn: () => {
      if (lastFailedTurn) void sendMessage(lastFailedTurn.text, lastFailedTurn.clientTurnId, lastFailedTurn.context);
    } };
}
