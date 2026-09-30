import { useEffect, useMemo, useRef } from 'react';
import { Sparkles, Square, ArrowUp } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

import { AiMessageContent } from './ai/AiMessageContent';
import { AiPendingReply } from './ai/AiPendingReply';
import { useAiConversation, type AiInvocationRequest } from './useAiConversation';
import type { AiActionType, AiUiAction } from '../lib/api/ai';
import './AiAssistantPanel.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onActions: (actions: AiUiAction[]) => void | Promise<void>;
  invocation?: AiInvocationRequest | null;
  onInvocationConsumed?: () => void;
  surface?: string;
}
const prompts = ["Show my most recent workouts","How is my strength progressing on Squat?","What is my training volume balance across muscles?"];
const actionLabels: Record<AiActionType, string> = {"openWorkout":"View workout","openExercise":"View exercise progress","openProgram":"View program","openHistory":"View workout history","openActiveWorkout":"View active workout","openAddWorkoutDraft":"Preview workout before starting"};

export function AiAssistantPanel({ isOpen, onClose, onActions, invocation, onInvocationConsumed, surface = 'dashboard' }: Props) {
  const defaultContext = useMemo(() => ({ surface, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }), [surface]);
  const chat = useAiConversation({ isOpen, onClose, onActions, invocation, onInvocationConsumed, defaultContext });
  const log = useRef<HTMLDivElement>(null);
  const disabled = chat.isSending || chat.isHydrating || chat.isResetting || chat.isResolving;
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat.messages, chat.pendingReply, chat.pendingActionBatches]);
  if (!isOpen) return null;
  return (
    <Modal title="Ask AI" onClose={onClose} wide className="ai-assistant-modal">
      <div className="ai-chat">
        <div className="ai-chat-toolbar">
          <span><Sparkles size={16} aria-hidden="true" /> Training assistant</span>
          {chat.hasConversation && <Button variant="tertiary" disabled={disabled} onClick={() => void chat.resetConversation()}>
            {chat.isResetting ? 'Resetting…' : 'New chat'}
          </Button>}
        </div>
        <div className="ai-chat-log" ref={log} role="log" aria-label="Conversation" aria-live="polite">
          {chat.isHydrating && <p role="status">Loading conversation…</p>}
          {!chat.isHydrating && chat.messages.length === 0 && !chat.pendingReply && <div className="ai-chat-empty">
            <p>Ask about workouts, exercise progress, or your program.</p>
            <div className="ai-chat-prompts">{prompts.map(prompt => <Button key={prompt} disabled={disabled || Boolean(chat.error)}
              onClick={() => void chat.sendMessage(prompt)}>{prompt}</Button>)}</div>
          </div>}
          {chat.messages.map((message, index) => <div key={index} className={`ai-chat-message ${message.role}`}>
            <AiMessageContent content={message.content} role={message.role} />
          </div>)}
          {chat.pendingReply && <AiPendingReply reply={chat.pendingReply} />}
          {chat.pendingActionBatches.map(batch => <div key={batch.batchId} className="ai-chat-review">
            <p>{batch.actions.map(action => actionLabels[action.type]).join(', ')}</p>
            {batch.actions.map((action, index) => <p className="ai-chat-action-detail" key={index}>
              {[action.payload.query, action.payload.date, action.payload.time].filter(value => typeof value === 'string').join(' · ')}
            </p>)}
            <small>Opens the existing screen. Changes still need your confirmation there.</small>
            <div className="ai-chat-actions">
              <Button disabled={disabled} onClick={() => void chat.resolveBatch(batch.batchId, 'dismissed')}>Dismiss</Button>
              <Button disabled={disabled} onClick={() => void chat.resolveBatch(batch.batchId, 'accepted')}>Open</Button>
            </div>
          </div>)}
        </div>
        {chat.error && <div className="ai-chat-error" role="alert">
          <p>{chat.error}</p>
          {chat.lastFailedTurn ? <Button disabled={disabled} onClick={chat.retryLastFailedTurn}>Retry message</Button>
            : <Button disabled={disabled} onClick={() => void chat.hydrate()}>Reload conversation</Button>}
        </div>}
        <form className="ai-chat-composer" onSubmit={event => { event.preventDefault(); void chat.sendMessage(); }}>
          <div className="field"><label htmlFor="ai-chat-message">Message</label><textarea id="ai-chat-message" rows={2} maxLength={2000} value={chat.input} onChange={event => chat.setInput(event.target.value)}
            disabled={disabled} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault(); void chat.sendMessage();
              }
            }} /></div>
          {chat.isSending ? <Button aria-label="Stop generating" onClick={chat.stopTurn}><Square size={18} /></Button>
            : <Button type="submit" variant="primary" aria-label="Send message" disabled={disabled || !chat.input.trim()}>
              <ArrowUp size={18} /></Button>}
        </form>
      </div>
    </Modal>
  );
}
